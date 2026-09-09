import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { StoredCampaign, StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import { initialConfig, loadSettings, loadVariants, loadProducts, saveCampaign, saveSettings, type Settings, type Variant, type Product } from './api';
import { ProductSelection, numericId, selectedProductIds } from './ProductSelection';
import { campaignStatus, formatTime, readSchedule, scheduleFields, type ScheduleFields } from './schedule';

export default async () => { render(<App />, document.body); };
const empty: StoredConfig = { version: 1, campaigns: [] };
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Issues = Partial<Record<'name' | 'trigger' | 'gift' | 'quantity' | 'schedule', string>>;
type Editor = { base?: StoredCampaign; draft: StoredCampaign; schedule: ScheduleFields; initial: string };
const editorValue = (editor: Pick<Editor, 'draft' | 'schedule'>) => JSON.stringify([editor.draft, editor.schedule]);

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<StoredConfig>(empty);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [variants, setVariants] = useState<Record<string, Variant>>({});
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(true);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Issues>({});
  const [confirmation, setConfirmation] = useState<'leave' | 'delete' | 'reload' | 'import' | null>(null);
  const [now, setNow] = useState(Date.now());
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const pending = useRef(false);
  const disabled = busy || pickerBusy;
  const timeZone = settings?.shop.ianaTimezone || 'UTC';
  const dirty = Boolean(editor && editorValue(editor) !== editor.initial);

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (confirmation) modal.current?.showOverlay(); }, [confirmation]);

  function mergeProducts(loaded: Record<string, Product>) {
    setProducts(previous => ({ ...previous, ...loaded }));
    setVariants(previous => ({ ...previous, ...Object.fromEntries(Object.values(loaded)
      .flatMap(product => product.variants.map(variant => [numericId(variant.id), variant]))) }));
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const snapshot = await loadSettings();
      const saved = initialConfig(snapshot);
      const variantIds = saved.campaigns.flatMap(campaign => [...campaign.triggerVariantIds, ...campaign.gifts.map(gift => gift.variantId)]);
      const loadedVariants = await loadVariants(variantIds);
      const productIds = [...saved.campaigns.flatMap(campaign => (campaign.triggerProducts ?? []).map(item => item.productId)),
        ...Object.values(loadedVariants).map(variant => numericId(variant.product.id))];
      setSettings(snapshot); setConfig(saved); setVariants(loadedVariants); setEditor(null); setIssues({});
      const loaded = await loadProducts([...new Set(productIds)]);
      setProducts(loaded); mergeProducts(loaded);
    } catch (cause) { setError(message(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  function edit(base?: StoredCampaign) {
    const draft: StoredCampaign = base ? clone(base) : {
      id: 'bogo-' + crypto.randomUUID(), name: '', enabled: false, showLabel: true,
      triggerVariantIds: [], triggerProducts: [], gifts: [],
    };
    const next = { base, draft, schedule: scheduleFields(draft, timeZone) };
    setEditor({ ...next, initial: editorValue(next) }); setError(''); setNotice(''); setIssues({});
    requestAnimationFrame(() => document.getElementById('campaign-name')?.focus());
  }
  function change(patch: Partial<StoredCampaign>) {
    setEditor(current => current ? { ...current, draft: { ...current.draft, ...patch } } : null);
    setNotice(''); setIssues({});
  }
  function changeSchedule(patch: Partial<ScheduleFields>) {
    setEditor(current => current ? { ...current, schedule: { ...current.schedule, ...patch } } : null);
    setIssues(previous => ({ ...previous, schedule: undefined })); setNotice('');
  }
  function leave() {
    if (disabled) return;
    if (dirty) setConfirmation('leave');
    else { setEditor(null); setIssues({}); setError(''); }
  }
  function focusIssue(key: keyof Issues) {
    const element = document.getElementById(key === 'name' ? 'campaign-name' : 'field-' + key);
    element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    element?.focus?.();
  }
  function validate(current: Editor): { campaign?: StoredCampaign; issues: Issues } {
    const problems: Issues = {};
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
    try { Object.assign(draft, readSchedule(current.schedule, timeZone, Date.now(), current.base)); }
    catch (cause) { problems.schedule = message(cause); }
    return Object.values(problems).some(Boolean) ? { issues: problems } : { campaign: draft, issues: {} };
  }
  async function save(remove = false) {
    if (!editor || !settings || disabled || pending.current) return;
    const checked = remove ? { campaign: undefined, issues: {} } : validate(editor);
    setIssues(checked.issues);
    if (!remove && !checked.campaign) {
      requestAnimationFrame(() => focusIssue(Object.keys(checked.issues)[0] as keyof Issues));
      return;
    }
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await saveCampaign(settings, editor.base, remove ? null : checked.campaign!);
      setSettings(result); setConfig(initialConfig(result)); setEditor(null);
      setNotice(remove ? '活动已删除' : '活动配置已保存');
    } catch (cause) { setError(message(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function importLegacy() {
    if (!settings || disabled || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await saveSettings(settings, config);
      setSettings(result); setConfig(initialConfig(result)); setNotice('旧活动已导入，后续可在这里管理。');
    } catch (cause) { setError(message(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  function confirmAction() {
    const action = confirmation;
    modal.current?.hideOverlay(); setConfirmation(null);
    if (action === 'delete') void save(true);
    if (action === 'import') void importLegacy();
    if (action === 'reload') void reload();
    if (action === 'leave') { setEditor(null); setIssues({}); setError(''); }
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
      {error && <s-banner tone="critical" heading="操作未完成">
        <s-paragraph>{error}</s-paragraph>
        <s-button variant="tertiary" disabled={disabled} onClick={() => dirty ? setConfirmation('reload') : void reload()}>重新加载</s-button>
      </s-banner>}
      {notice && <s-banner tone="success">{notice}</s-banner>}
      {settings?.warnings?.map(warning => <s-banner key={warning} tone="warning">{warning}</s-banner>)}
      {busy && !settings && <s-section><s-spinner accessibilityLabel="正在读取活动" /></s-section>}
      {!editor && settings && <>
        {!settings.shop.mode && config.campaigns.length > 0 && <s-banner tone="info" heading="旧活动待导入">
          <s-paragraph>{settings.shop.myshopifyDomain} 有 {config.campaigns.length} 个旧活动。确认列表后可切换为页面管理。</s-paragraph>
          <s-button disabled={disabled} onClick={() => setConfirmation('import')}>导入旧活动</s-button>
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
          {issueEntries.map(([key, value]) => <s-button key={key} variant="tertiary" onClick={() => focusIssue(key as keyof Issues)}>{value}</s-button>)}
        </s-banner>}
        <s-stack gap="base">
            <s-section heading="活动信息"><s-text-field id="campaign-name" label="活动名称" placeholder="例如：Node 键盘买赠"
              value={editor.draft.name ?? ''} maxLength={100} disabled={disabled} error={issues.name}
              onInput={event => change({ name: event.currentTarget.value })} details="同步为 Shopify 折扣名称，顾客结账时可能看到。" /></s-section>
            <s-box id="field-trigger"><ProductSelection role="trigger" campaign={editor.draft}
              products={products} variants={variants} disabled={disabled} error={issues.trigger}
              onChange={change} onProducts={mergeProducts} onBusy={setPickerBusy} /></s-box>
            <s-box id="field-gift"><ProductSelection role="gift" campaign={editor.draft}
              products={products} variants={variants} disabled={disabled} error={issues.gift}
              onChange={change} onProducts={mergeProducts} onBusy={setPickerBusy} /></s-box>
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
            {editor.base && <s-box paddingBlockEnd="base"><s-button tone="critical" disabled={disabled} onClick={() => setConfirmation('delete')}>删除活动</s-button></s-box>}
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
    <s-modal ref={modal} id="confirm-action" heading={confirmation === 'delete' ? '删除这个活动？' : confirmation === 'import' ? '切换为页面管理？' : '放弃未保存的修改？'}
      onAfterHide={() => setConfirmation(null)}>
      <s-paragraph>{confirmation === 'delete' ? '将删除「' + (editor?.base?.name || '当前活动') + '」。删除成功后，该活动停止参与促销。'
        : confirmation === 'import' ? '将导入当前列表中的 ' + config.campaigns.length + ' 个活动，并使用页面配置管理。'
          : '当前填写的内容尚未保存。放弃后无法恢复。'}</s-paragraph>
      <s-button slot="primary-action" variant="primary" tone={confirmation === 'import' ? 'auto' : 'critical'} onClick={confirmAction}>
        {confirmation === 'delete' ? '删除活动' : confirmation === 'import' ? '确认导入' : '放弃修改'}
      </s-button>
      <s-button slot="secondary-actions" commandFor="confirm-action" command="--hide">{confirmation === 'delete' || confirmation === 'import' ? '取消' : '继续编辑'}</s-button>
    </s-modal>
  </s-page>;
}
