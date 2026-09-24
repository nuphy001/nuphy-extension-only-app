import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StoredCampaign, StoredConfig, Catalog, Editor, Operation, PageData, PageState, ScheduleFields } from './types/campaign';
import type { PickerOptions, PickerProductSelection, ProductRole, Product } from './types/api';
import { initialConfig, loadSettings, loadVariants, loadProducts, saveCampaign, saveSettings, pickProducts } from './api';
import { ProductSelection } from './components/product-selection';
import { CampaignTable } from './components/campaign-table';
import { ConfigurationStatus } from './components/configuration-status';
import { applyProductSelection, numericId, selectedProductIds, productVariants } from './utils/selection';
import { Confirmation } from './components/confirmation';
import { HelpTip } from './components/help-tip';
import { campaignStatus, formatTime, readSchedule, scheduleFields } from './utils/schedule';
import { validateEditor, validateGiftSelection } from './utils/validation';
import { errorMessage } from './utils/errors';

export default async () => { render(<App />, document.body); };
const empty: StoredConfig = { version: 1, campaigns: [] };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
// 只比较需要保存的草稿和排期，忽略临时的选择器开关与校验提示。
const editorValue = (editor: Pick<Editor, 'draft' | 'schedule'>) => JSON.stringify([editor.draft, editor.schedule]);

// 合并新读取的产品，同时补齐规格索引，保留尚未重读的已有数据。
function withProducts<T extends Catalog>(catalog: T, loaded: Record<string, Product>): T {
  return {
    ...catalog,
    products: { ...catalog.products, ...loaded },
    variants: { ...catalog.variants, ...productVariants(loaded) },
  };
}

// 先读取活动配置，再补齐旧规格和产品信息，供列表与编辑页共用。
async function loadPageData(): Promise<PageData> {
  const settings = await loadSettings();
  const config = initialConfig(settings);
  const variants = await loadVariants(config.campaigns.flatMap(campaign => [...campaign.triggerVariantIds, ...campaign.gifts.map(gift => gift.variantId)]));
  const productIds = [...config.campaigns.flatMap(campaign => (campaign.triggerProducts ?? []).map(item => item.productId)),
    ...Object.values(variants).map(variant => numericId(variant.product.id))];
  const products = await loadProducts([...new Set(productIds)]);
  return withProducts({ settings, products, variants }, products);
}

function App() {
  const [page, setPage] = useState<PageState>({ data: null, editor: null, operation: 'load', feedback: null });
  const [clock, setClock] = useState(Date.now());
  // 同步锁防止连续点击在下一次渲染前启动第二个操作，所有异步入口共用。
  const inFlight = useRef(false);
  const discardModal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const { data, editor, operation, feedback } = page;
  const settings = data?.settings;
  const config = settings ? initialConfig(settings) : empty;
  const products = data?.products ?? {};
  const variants = data?.variants ?? {};
  const issues = editor?.issues ?? {};
  const busy = operation === 'load' || operation === 'save' || operation === 'import';
  const disabled = operation !== null;
  const timeZone = settings?.shop.ianaTimezone || 'UTC';
  const dirty = Boolean(editor && editorValue(editor) !== editor.initial);
  const now = Date.now();

  // 只负责首次读取；后续读取和写入都由明确的用户操作触发。
  useEffect(() => { void reload(); }, []);

  // 串行执行页面操作，并将错误放到对应字段或页面提示中。
  async function run(operation: Operation, work: () => Promise<Partial<PageState>>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPage(current => ({ ...current, operation, feedback: null }));
    try {
      const result = await work();
      setPage(current => ({ ...current, ...result, operation: null,
        feedback: result.feedback?.tone === 'success' ? null : result.feedback ?? null }));
      if (result.feedback?.tone === 'success') shopify.toast.show(result.feedback.text);
    } catch (cause) {
      setPage(current => operation === 'trigger' || operation === 'gift'
        ? { ...current, operation: null, editor: current.editor && { ...current.editor, issues: { ...current.editor.issues, [operation]: errorMessage(cause) } } }
        : { ...current, operation: null, feedback: { tone: 'critical', text: errorMessage(cause) } });
    } finally { inFlight.current = false; }
  }

  function reload() {
    return run('load', async () => ({ data: await loadPageData(), editor: null }));
  }
  // 从原活动复制草稿，记录初始值以判断是否有未保存的修改。
  function edit(base?: StoredCampaign) {
    if (inFlight.current) return;
    const draft: StoredCampaign = base ? clone(base) : {
      id: 'bogo-' + crypto.randomUUID(), name: '', enabled: false, showLabel: true,
      triggerVariantIds: [], triggerProducts: [], gifts: [],
    };
    const next = { base, draft, schedule: scheduleFields(draft, timeZone) };
    setPage(current => ({ ...current, editor: { ...next, initial: editorValue(next), issues: {} }, feedback: null }));
  }
  function change(patch: Partial<StoredCampaign>) {
    if (inFlight.current) return;
    setPage(current => ({ ...current, feedback: null, editor: current.editor && {
      ...current.editor, draft: { ...current.editor.draft, ...patch }, issues: {},
    } }));
  }
  function changeSchedule(patch: Partial<ScheduleFields>) {
    if (inFlight.current) return;
    setPage(current => ({ ...current, feedback: null, editor: current.editor && {
      ...current.editor, schedule: { ...current.editor.schedule, ...patch }, issues: { ...current.editor.issues, schedule: undefined },
    } }));
  }
  function closeEditor() {
    if (!inFlight.current) setPage(current => ({ ...current, editor: null, feedback: null }));
  }
  function leave() {
    if (inFlight.current) return;
    // 页头 slot 的按钮不转发 command，直接调用原生弹窗方法。
    if (dirty) discardModal.current?.showOverlay();
    else closeEditor();
  }

  // 原生选择器确认后回填草稿，取消选择时保留原值。
  function browse(role: ProductRole, initial: PickerProductSelection[], search: string, options: PickerOptions = {}) {
    if (!data || !editor) return;
    return run(role, async () => {
      const result = await pickProducts(initial, search, role === 'gift' ? options : {});
      if (!result) return {};
      const patch = applyProductSelection(editor.draft, role, result, variants);
      validateGiftSelection(patch, options);
      return { data: withProducts(data, result.products), editor: {
        ...editor, draft: { ...editor.draft, ...patch }, issues: {},
      } };
    });
  }
  function retryProduct(role: ProductRole, id: string) {
    if (!data || !editor) return;
    return run(role, async () => ({ data: withProducts(data, await loadProducts([id])), editor: { ...editor, issues: {} } }));
  }
  // 保存前校验表单；删除直接提交空值，失败时保留当前草稿。
  function save(remove = false) {
    if (!editor || !data || inFlight.current) return;
    const checked = remove ? { campaign: undefined, issues: {} } : validateEditor(editor, data, timeZone);
    if (!remove && !checked.campaign) {
      setPage(current => ({ ...current, editor: current.editor && { ...current.editor, issues: checked.issues } }));
      return;
    }
    return run('save', async () => {
      const settings = await saveCampaign(data.settings, editor.base, remove ? null : checked.campaign!);
      return { data: { ...data, settings }, editor: null, feedback: { tone: 'success', text: remove ? '活动已删除' : '活动配置已保存' } };
    });
  }
  function importLegacy() {
    if (!data) return;
    return run('import', async () => ({ data: { ...data, settings: await saveSettings(data.settings, config) },
      feedback: { tone: 'success', text: '旧活动已导入，后续可在这里管理。' } }));
  }

  const preview = editor && (() => {
    try { return { ...editor.draft, ...readSchedule(editor.schedule, timeZone, now, editor.base) }; }
    catch { return null; }
  })();
  // 只在最近一个开始/结束时刻刷新状态，不每秒重绘整份表单。
  const nextChange = Math.min(...[...config.campaigns, ...(preview ? [preview] : [])]
    .filter(campaign => campaign.enabled).flatMap(campaign => [campaign.startsAt, campaign.endsAt])
    .filter((value): value is string => Boolean(value)).map(Date.parse).filter(time => time > now));
  useEffect(() => {
    if (!Number.isFinite(nextChange)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(Math.max(0, nextChange - Date.now()), 2147483647));
    return () => clearTimeout(timer);
  }, [nextChange, clock]);
  const status = preview ? campaignStatus(preview, now) : null;
  const issueEntries = Object.entries(issues).filter(([, value]) => value);
  return <s-page heading={editor ? editor.base ? '编辑活动' : '创建买赠活动' : '买赠活动'} inlineSize={editor ? 'base' : 'large'}>
    {editor
      ? <>
        <s-button slot="breadcrumb-actions" disabled={disabled} onClick={leave}>买赠活动</s-button>
        <s-button slot="primary-action" variant="primary" loading={busy} disabled={disabled || (!dirty && Boolean(editor.base))} onClick={() => void save()}>保存活动</s-button>
        <s-button slot="secondary-actions" disabled={disabled} onClick={leave}>取消</s-button>
      </>
      : <s-button slot="primary-action" variant="primary" disabled={disabled || !settings} onClick={() => edit()}>创建活动</s-button>}
    <s-stack gap="base">
      {feedback && <s-banner tone={feedback.tone} heading={feedback.tone === 'critical' ? '操作未完成' : undefined}>
        <s-paragraph>{feedback.text}</s-paragraph>
        {feedback.tone === 'critical' && <s-button variant="tertiary" disabled={disabled}
          commandFor={dirty ? 'reload-confirm' : undefined} command={dirty ? '--show' : undefined}
          onClick={() => { if (!dirty) void reload(); }}>重新加载</s-button>}
      </s-banner>}
      {settings?.warnings?.map(warning => <s-banner key={warning} tone="warning">{warning}</s-banner>)}
      {busy && !settings && <s-section><s-spinner accessibilityLabel="正在读取活动" /></s-section>}
      {settings && <ConfigurationStatus settings={settings} state={editor ? !editor.base ? 'new' : dirty ? 'dirty' : 'saved' : undefined} />}
      {!editor && settings && <>
        {!settings.shop.mode && config.campaigns.length > 0 && <s-banner tone="info" heading="旧活动待导入">
          <s-paragraph>{settings.shop.myshopifyDomain} 有 {config.campaigns.length} 个旧活动。确认列表后可切换为页面管理。</s-paragraph>
          <s-button disabled={disabled} commandFor="import-confirm" command="--show">导入旧活动</s-button>
        </s-banner>}
        {config.campaigns.length === 0
          ? <s-section><s-stack gap="base" alignItems="center">
            <s-icon type="gift" size="base" />
            <s-heading>创建第一个买赠活动</s-heading>
            <s-paragraph>选择适用产品和赠品，设置活动时间。</s-paragraph>
            <s-text color="subdued">点击右上角“创建活动”开始。</s-text>
          </s-stack></s-section>
          : <CampaignTable campaigns={config.campaigns} products={products} variants={variants} disabled={disabled} now={now} onEdit={edit} />}
      </>}
      {editor && <>
        {issueEntries.length > 0 && <s-banner tone="critical" heading="请完善以下内容">
          {issueEntries.map(([key, value]) => <s-paragraph key={key}>{value}</s-paragraph>)}
        </s-banner>}
        <s-stack gap="base">
            <s-section heading="活动信息"><s-stack gap="small-400">
              <s-stack direction="inline" gap="small-400" alignItems="center">
                <s-text accessibilityVisibility="hidden">活动名称</s-text>
                <HelpTip id="campaign-name-help" label="活动名称说明">作为 Shopify 折扣名称的前缀，系统会附加唯一标识。顾客结账时可能看到。</HelpTip>
              </s-stack>
              <s-text-field id="campaign-name" label="活动名称" labelAccessibilityVisibility="exclusive" placeholder="例如：Node 键盘买赠"
                value={editor.draft.name ?? ''} maxLength={100} disabled={disabled} error={issues.name}
                onInput={event => change({ name: event.currentTarget.value })} />
            </s-stack></s-section>
            <s-box id="field-trigger"><ProductSelection role="trigger" campaign={editor.draft}
              products={products} variants={variants} disabled={disabled} error={issues.trigger}
              onChange={change} onBrowse={(initial, search) => void browse('trigger', initial, search)} onRetry={id => void retryProduct('trigger', id)} /></s-box>
            <s-box id="field-gift"><ProductSelection role="gift" campaign={editor.draft}
              products={products} variants={variants} disabled={disabled} error={issues.gift}
              options={editor.giftPickerOptions}
              onOptionsChange={giftPickerOptions => {
                if (!inFlight.current) setPage(current => ({ ...current, editor: current.editor && { ...current.editor, giftPickerOptions, issues: { ...current.editor.issues, gift: undefined } } }));
              }}
              onChange={change} onBrowse={(initial, search, options) => void browse('gift', initial, search, options)} onRetry={id => void retryProduct('gift', id)} /></s-box>
            <s-section heading="数量规则">
              <s-stack gap="base">
                <s-stack gap="small-400">
                  <s-stack direction="inline" gap="small-400" alignItems="center">
                    <s-text accessibilityVisibility="hidden">每个赠品规格的加入数量</s-text>
                    <HelpTip id="gift-quantity-help" label="赠品数量与免费额度说明">免费额度按参与活动的主商品件数计算，多个赠品共享额度。</HelpTip>
                  </s-stack>
                  <s-select id="field-quantity" label="每个赠品规格的加入数量" labelAccessibilityVisibility="exclusive" disabled={disabled}
                    value={editor.draft.triggerQuantity === undefined ? 'follow' : 'fixed'}
                    onChange={event => change({ triggerQuantity: event.currentTarget.value === 'fixed' ? 1 : undefined })}>
                    <s-option value="follow">随参与活动的主商品数量</s-option><s-option value="fixed">固定数量</s-option>
                  </s-select>
                </s-stack>
                {editor.draft.triggerQuantity !== undefined && <s-number-field label="每个赠品规格加入几件" min={1} step={1}
                  value={String(editor.draft.triggerQuantity)} disabled={disabled} error={issues.quantity}
                  onInput={event => change({ triggerQuantity: Number(event.currentTarget.value) })} />}
                {(editor.draft.gifts.length > 1 || (editor.draft.triggerQuantity ?? 1) > 1) && <s-banner tone="warning">
                  多个赠品会分别加入购物车；加入数量超过免费额度时，超出部分不会免费。
                </s-banner>}
              </s-stack>
            </s-section>
            <s-section heading="活动时间"><s-stack gap="base">
              <s-text color="subdued">店铺时区：{timeZone}</s-text>
              <s-select id="field-schedule" label="开始方式" disabled={disabled} value={editor.schedule.start}
                onChange={event => changeSchedule({ start: event.currentTarget.value as 'now' | 'scheduled' })}>
                <s-option value="now">保存并启用后立即开始</s-option><s-option value="scheduled">指定开始时间</s-option>
              </s-select>
              {editor.schedule.start === 'scheduled' && <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-date-field label="开始日期" value={editor.schedule.startDate} disabled={disabled}
                  onInput={event => changeSchedule({ startDate: event.currentTarget.value })} />
                <s-text-field label="开始时间" value={editor.schedule.startTime} placeholder="HH:mm" disabled={disabled}
                  onInput={event => changeSchedule({ startTime: event.currentTarget.value })} />
              </s-grid>}
              <s-stack direction="inline" gap="small-400" alignItems="center">
                <s-checkbox label="设置结束时间" checked={editor.schedule.hasEnd} disabled={disabled}
                  onChange={event => changeSchedule({ hasEnd: event.currentTarget.checked })} />
                <HelpTip id="campaign-end-help" label="结束时间说明">不设置结束时间时，活动持续到手动停用。</HelpTip>
              </s-stack>
              {editor.schedule.hasEnd && <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-date-field label="结束日期" value={editor.schedule.endDate} disabled={disabled}
                  onInput={event => changeSchedule({ endDate: event.currentTarget.value })} />
                <s-text-field label="结束时间" value={editor.schedule.endTime} placeholder="HH:mm" disabled={disabled}
                  onInput={event => changeSchedule({ endTime: event.currentTarget.value })} />
              </s-grid>}
              {issues.schedule && <s-text tone="critical">{issues.schedule}</s-text>}
            </s-stack></s-section>
            {editor.base && <s-box paddingBlockEnd="base"><s-button tone="critical" disabled={disabled} commandFor="delete-confirm" command="--show">删除活动</s-button></s-box>}
        </s-stack>
      </>}
    </s-stack>
    {editor && <s-stack slot="aside" gap="base">
            <s-section heading="状态与显示"><s-stack gap="base">
              <s-select label="保存后状态" disabled={disabled} value={editor.draft.enabled ? 'enabled' : 'disabled'}
                onChange={event => change({ enabled: event.currentTarget.value === 'enabled' })}>
                <s-option value="disabled">停用</s-option><s-option value="enabled">启用，并按活动时间运行</s-option>
              </s-select>
              <s-stack direction="inline" gap="small-400" alignItems="center">
                <s-checkbox label="在购物车显示 FREE GIFT 标签" checked={editor.draft.showLabel ?? true} disabled={disabled}
                  onChange={event => change({ showLabel: event.currentTarget.checked })} />
                <HelpTip id="gift-label-help" label="FREE GIFT 标签说明">只影响购物车标签的显示，不改变赠品和折扣规则。</HelpTip>
              </s-stack>
            </s-stack></s-section>
            <s-section heading="活动摘要"><s-stack gap="small">
              <s-text>{selectedProductIds(editor.draft, variants, 'trigger').length} 款适用产品 · {editor.draft.gifts.length} 个赠品规格</s-text>
              <s-text>{preview ? formatTime(preview.startsAt, timeZone, '立即开始') + ' — ' + formatTime(preview.endsAt, timeZone, '无结束时间') : '请完善活动时间'}</s-text>
              {status && <s-stack direction="inline" gap="small"><s-text>保存后</s-text><s-badge tone={status.tone}>{status.label}</s-badge></s-stack>}
            </s-stack></s-section>
    </s-stack>}
    <Confirmation overlayRef={discardModal} id="discard-edit" heading="放弃未保存的修改？" action="放弃修改" onConfirm={closeEditor}>
      当前填写的内容尚未保存。放弃后无法恢复。
    </Confirmation>
    <Confirmation id="reload-confirm" heading="放弃修改并重新加载？" action="重新加载" onConfirm={() => void reload()}>
      重新加载将放弃未保存的修改，并读取店铺最新配置。
    </Confirmation>
    <Confirmation id="delete-confirm" heading="删除这个活动？" action="删除活动" onConfirm={() => void save(true)}>
      将删除「{editor?.base?.name || '当前活动'}」。删除成功后，该活动停止参与促销。
    </Confirmation>
    <Confirmation id="import-confirm" heading="切换为页面管理？" action="确认导入" onConfirm={() => void importLegacy()}>
      将导入当前列表中的 {config.campaigns.length} 个活动，并使用页面配置管理。
    </Confirmation>
  </s-page>;
}
