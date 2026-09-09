import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StoredCampaign, StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import { initialConfig, loadSettings, loadVariants, loadProducts, saveCampaign, saveSettings, pickProducts, type PickerProductSelection, type Settings, type Variant, type Product } from './api';
import { ProductSelection, applyProductSelection, numericId, selectedProductIds } from './ProductSelection';
import { campaignStatus, formatTime, readSchedule, scheduleFields, type ScheduleFields } from './schedule';

export default async () => { render(<App />, document.body); };
const empty: StoredConfig = { version: 1, campaigns: [] };
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Issues = Partial<Record<'name' | 'trigger' | 'gift' | 'quantity' | 'schedule', string>>;
type Editor = { base?: StoredCampaign; draft: StoredCampaign; schedule: ScheduleFields; initial: string; issues: Issues };
type Catalog = { products: Record<string, Product>; variants: Record<string, Variant> };
type PageData = Catalog & { settings: Settings };
type Operation = 'load' | 'save' | 'import' | 'trigger' | 'gift';
type PageState = {
  data: PageData | null;
  editor: Editor | null;
  operation: Operation | null;
  feedback: { tone: 'success' | 'critical'; text: string } | null;
};
const editorValue = (editor: Pick<Editor, 'draft' | 'schedule'>) => JSON.stringify([editor.draft, editor.schedule]);

function withProducts<T extends Catalog>(catalog: T, loaded: Record<string, Product>): T {
  return {
    ...catalog,
    products: { ...catalog.products, ...loaded },
    variants: { ...catalog.variants, ...Object.fromEntries(Object.values(loaded)
      .flatMap(product => product.variants.map(variant => [numericId(variant.id), variant]))) },
  };
}

async function loadPageData(): Promise<PageData> {
  const settings = await loadSettings();
  const config = initialConfig(settings);
  const variants = await loadVariants(config.campaigns.flatMap(campaign => [...campaign.triggerVariantIds, ...campaign.gifts.map(gift => gift.variantId)]));
  const productIds = [...config.campaigns.flatMap(campaign => (campaign.triggerProducts ?? []).map(item => item.productId)),
    ...Object.values(variants).map(variant => numericId(variant.product.id))];
  const products = await loadProducts([...new Set(productIds)]);
  return withProducts({ settings, products, variants }, products);
}

export function validateEditor(current: Editor, catalog: Catalog, timeZone: string, now = Date.now()): { campaign?: StoredCampaign; issues: Issues } {
  const problems: Issues = {};
  const { products, variants } = catalog;
  const draft = { ...current.draft, name: current.draft.name?.trim() };
  if (!draft.name) problems.name = '请填写活动名称';
  if (!draft.triggerProducts?.length && !draft.triggerVariantIds.length) problems.trigger = '请选择至少一个适用产品';
  for (const rule of draft.triggerProducts ?? []) {
    const product = products[rule.productId];
    if (!product || product.variants.length !== product.variantsCount) problems.trigger = '产品规格尚未完整读取，请重试后再保存';
    else if (product.variants.every(variant => rule.excludedVariantIds.includes(numericId(variant.id)))) {
      problems.trigger = '至少保留一个参与规格，或移除不参与的产品';
    }
  }
  if (draft.triggerVariantIds.some(id => !variants[id])) problems.trigger = '部分适用规格无法读取，请重试或移除';
  if (!draft.gifts.length) problems.gift = '请在浏览弹窗中选择至少一个赠品规格';
  if (draft.gifts.some(gift => !variants[gift.variantId])) problems.gift = '部分赠品规格无法读取，请重试或移除';
  if (draft.triggerQuantity !== undefined && (!Number.isInteger(draft.triggerQuantity) || draft.triggerQuantity < 1 || draft.triggerQuantity > 2147483647)) {
    problems.quantity = '请填写大于 0 的整数';
  }
  try { Object.assign(draft, readSchedule(current.schedule, timeZone, now, current.base)); }
  catch (cause) { problems.schedule = message(cause); }
  return Object.values(problems).some(Boolean) ? { issues: problems } : { campaign: draft, issues: {} };
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

  async function run(operation: Operation, work: () => Promise<Partial<PageState>>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPage(current => ({ ...current, operation, feedback: null }));
    try {
      const result = await work();
      setPage(current => ({ ...current, ...result, operation: null }));
    } catch (cause) {
      setPage(current => operation === 'trigger' || operation === 'gift'
        ? { ...current, operation: null, editor: current.editor && { ...current.editor, issues: { ...current.editor.issues, [operation]: message(cause) } } }
        : { ...current, operation: null, feedback: { tone: 'critical', text: message(cause) } });
    } finally { inFlight.current = false; }
  }

  function reload() {
    return run('load', async () => ({ data: await loadPageData(), editor: null }));
  }
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

  function browse(role: 'trigger' | 'gift', initial: PickerProductSelection[], search: string) {
    if (!data || !editor) return;
    return run(role, async () => {
      const result = await pickProducts(initial, search);
      if (!result) return {};
      return { data: withProducts(data, result.products), editor: {
        ...editor, draft: { ...editor.draft, ...applyProductSelection(editor.draft, role, result, variants) }, issues: {},
      } };
    });
  }
  function retryProduct(role: 'trigger' | 'gift', id: string) {
    if (!data || !editor) return;
    return run(role, async () => ({ data: withProducts(data, await loadProducts([id])), editor: { ...editor, issues: {} } }));
  }
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
  function productSummary(campaign: StoredCampaign, role: 'trigger' | 'gift') {
    const ids = selectedProductIds(campaign, variants, role);
    if (!ids.length) return '产品信息暂不可用';
    const names = ids.slice(0, 2).map(id => products[id]?.title ?? '产品信息暂不可用').join('、');
    const excluded = (campaign.triggerProducts ?? []).reduce((count, product) => count + product.excludedVariantIds.length, 0);
    return names + (ids.length > 2 ? ' 等 ' + ids.length + ' 款' : '') + (role === 'trigger' && excluded ? ' · 排除 ' + excluded + ' 个规格' : '');
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
  return <s-page heading={editor ? editor.base ? '编辑活动' : '创建买赠活动' : '买赠活动'}>
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
          : <s-section padding="none">
            <s-box padding="base"><s-text color="subdued">{config.campaigns.length} 个活动 · 店铺时区 {timeZone}</s-text></s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">活动</s-table-header><s-table-header>适用产品</s-table-header>
                <s-table-header>赠品</s-table-header><s-table-header>活动时间</s-table-header><s-table-header>状态</s-table-header>
              </s-table-header-row>
              <s-table-body>{config.campaigns.map(campaign => {
                const state = campaignStatus(campaign, now);
                return <s-table-row key={campaign.id}>
                  <s-table-cell><s-button variant="tertiary" disabled={disabled} onClick={() => edit(campaign)}>{campaign.name || '未命名活动'}</s-button></s-table-cell>
                  <s-table-cell>{productSummary(campaign, 'trigger')}</s-table-cell>
                  <s-table-cell>{productSummary(campaign, 'gift')}</s-table-cell>
                  <s-table-cell><s-stack gap="small-400"><s-text>{formatTime(campaign.startsAt, timeZone, '立即开始')}</s-text>
                    <s-text color="subdued">{formatTime(campaign.endsAt, timeZone, '无结束时间')}</s-text></s-stack></s-table-cell>
                  <s-table-cell><s-badge tone={state.tone}>{state.label}</s-badge></s-table-cell>
                </s-table-row>;
              })}</s-table-body>
            </s-table>
          </s-section>}
      </>}
      {editor && <>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={dirty ? 'warning' : 'neutral'}>{editor.base ? dirty ? '有未保存的修改' : '已保存' : '尚未保存'}</s-badge>
          <s-text color="subdued">{editor.base?.name || '新活动'} · 保存只影响这个活动</s-text>
        </s-stack>
        {issueEntries.length > 0 && <s-banner tone="critical" heading="请完善以下内容">
          {issueEntries.map(([key, value]) => <s-paragraph key={key}>{value}</s-paragraph>)}
        </s-banner>}
        <s-stack gap="base">
            <s-section heading="活动信息"><s-text-field id="campaign-name" label="活动名称" placeholder="例如：Node 键盘买赠"
              value={editor.draft.name ?? ''} maxLength={100} disabled={disabled} error={issues.name}
              onInput={event => change({ name: event.currentTarget.value })} details="同步为 Shopify 折扣名称，顾客结账时可能看到。" /></s-section>
            <s-box id="field-trigger"><ProductSelection role="trigger" campaign={editor.draft}
              products={products} variants={variants} disabled={disabled} error={issues.trigger}
              onChange={change} onBrowse={(initial, search) => void browse('trigger', initial, search)} onRetry={id => void retryProduct('trigger', id)} /></s-box>
            <s-box id="field-gift"><ProductSelection role="gift" campaign={editor.draft}
              products={products} variants={variants} disabled={disabled} error={issues.gift}
              onChange={change} onBrowse={(initial, search) => void browse('gift', initial, search)} onRetry={id => void retryProduct('gift', id)} /></s-box>
            <s-section heading="数量规则">
              <s-stack gap="base">
                <s-select id="field-quantity" label="每个赠品规格的加入数量" disabled={disabled}
                  value={editor.draft.triggerQuantity === undefined ? 'follow' : 'fixed'}
                  onChange={event => change({ triggerQuantity: event.currentTarget.value === 'fixed' ? 1 : undefined })}>
                  <s-option value="follow">随参与活动的主商品数量</s-option><s-option value="fixed">固定数量</s-option>
                </s-select>
                {editor.draft.triggerQuantity !== undefined && <s-number-field label="每个赠品规格加入几件" min={1} step={1}
                  value={String(editor.draft.triggerQuantity)} disabled={disabled} error={issues.quantity}
                  onInput={event => change({ triggerQuantity: Number(event.currentTarget.value) })} />}
                <s-text color="subdued">免费额度按参与活动的主商品件数计算，多个赠品共享额度。</s-text>
                {(editor.draft.gifts.length > 1 || (editor.draft.triggerQuantity ?? 1) > 1) && <s-banner tone="warning">
                  多个赠品会分别加入购物车；加入数量超过免费额度时，超出部分不会免费。
                </s-banner>}
              </s-stack>
            </s-section>
            <s-section heading="活动时间"><s-stack gap="base">
              <s-text color="subdued">店铺时区：{timeZone}</s-text>
              <s-select id="field-schedule" label="开始时间" disabled={disabled} value={editor.schedule.start}
                onChange={event => changeSchedule({ start: event.currentTarget.value as 'now' | 'scheduled' })}>
                <s-option value="now">保存并启用后立即开始</s-option><s-option value="scheduled">指定开始时间</s-option>
              </s-select>
              {editor.schedule.start === 'scheduled' && <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-date-field label="开始日期" value={editor.schedule.startDate} disabled={disabled}
                  onInput={event => changeSchedule({ startDate: event.currentTarget.value })} />
                <s-text-field label="开始时刻" value={editor.schedule.startTime} placeholder="HH:mm" disabled={disabled}
                  onInput={event => changeSchedule({ startTime: event.currentTarget.value })} />
              </s-grid>}
              <s-checkbox label="设置结束时间" checked={editor.schedule.hasEnd} disabled={disabled}
                onChange={event => changeSchedule({ hasEnd: event.currentTarget.checked })} />
              {editor.schedule.hasEnd && <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-date-field label="结束日期" value={editor.schedule.endDate} disabled={disabled}
                  onInput={event => changeSchedule({ endDate: event.currentTarget.value })} />
                <s-text-field label="结束时刻" value={editor.schedule.endTime} placeholder="HH:mm" disabled={disabled}
                  onInput={event => changeSchedule({ endTime: event.currentTarget.value })} />
              </s-grid>}
              {issues.schedule && <s-text tone="critical">{issues.schedule}</s-text>}
              {!editor.schedule.hasEnd && <s-text color="subdued">无结束时间，可随时停用活动。</s-text>}
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
              <s-checkbox label="在购物车显示 FREE GIFT 标签" checked={editor.draft.showLabel ?? true} disabled={disabled}
                onChange={event => change({ showLabel: event.currentTarget.checked })} />
              <s-text color="subdued">标签只影响显示，不改变赠品和折扣规则。</s-text>
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

function Confirmation({ id, heading, action, onConfirm, children, overlayRef }: {
  id: string; heading: string; action: string; onConfirm: () => void; children: preact.ComponentChildren;
  overlayRef?: preact.Ref<HTMLElementTagNameMap['s-modal']>;
}) {
  return <s-modal ref={overlayRef} id={id} heading={heading}>
    <s-paragraph>{children}</s-paragraph>
    <s-button slot="primary-action" variant="primary" tone={id === 'import-confirm' ? 'auto' : 'critical'}
      commandFor={id} command="--hide" onClick={onConfirm}>{action}</s-button>
    <s-button slot="secondary-actions" commandFor={id} command="--hide">取消</s-button>
  </s-modal>;
}
