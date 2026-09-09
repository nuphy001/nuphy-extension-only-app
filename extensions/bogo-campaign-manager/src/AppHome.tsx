import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { configBytes, type StoredCampaign, type StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import { initialConfig, loadSettings, loadVariants, saveSettings, pickVariants, type Settings, type Variant } from './api';

export default async () => { render(<App />, document.body); };
const empty: StoredConfig = { version: 1, campaigns: [] };
const errorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('INVALID_COMPARE_DIGEST') || message.includes('其他人修改')) return '这条活动刚刚被别人改过了。请先重新加载，再重新保存。';
  if (message.includes('配置不可用') || message.includes('Promotion configuration')) return '活动配置暂时读不到，请刷新页面后再试。';
  if (message.includes('超过容量')) return '活动太多或商品太多了，请删掉不用的活动后再保存。';
  return message || '没有保存成功，请稍后再试。';
};
const variantIds = (config: StoredConfig) => config.campaigns.flatMap(campaign => [
  ...campaign.triggerVariantIds, ...campaign.gifts.map(gift => gift.variantId),
]);

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<StoredConfig>(empty);
  const [saved, setSaved] = useState<StoredConfig>(empty);
  const [variants, setVariants] = useState<Record<string, Variant>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [pickerRole, setPickerRole] = useState<'trigger' | 'gift' | null>(null);
  const pickerPending = useRef(false);
  const [pickerError, setPickerError] = useState('');
  const disabled = busy || pickerRole !== null;
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const selected = config.campaigns.find(campaign => campaign.id === selectedId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true); setError('');
      try {
        const snapshot = await loadSettings();
        const initial = initialConfig(snapshot);
        const products = await loadVariants(variantIds(initial));
        if (cancelled) return;
        setSettings(snapshot); setConfig(initial); setSaved(initial); setVariants(products);
        setSelectedId(null); setNotice('');
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [loadAttempt]);

  function update(id: string, patch: Partial<StoredCampaign>) {
    setConfig(previous => ({ ...previous, campaigns: previous.campaigns.map(campaign => campaign.id === id ? { ...campaign, ...patch } : campaign) }));
    setNotice('');
  }
  function addCampaign() {
    const id = `bogo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setConfig(previous => ({ ...previous, campaigns: [...previous.campaigns, {
      id, name: '新买赠活动', enabled: false, triggerVariantIds: [], gifts: [],
    }] }));
    setSelectedId(id); setNotice(''); setPickerError('');
  }
  async function save() {
    if (!settings || busy || pickerPending.current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (config.campaigns.some(campaign => !campaign.name?.trim())) throw new Error('请填写每个活动的名称');
      const next = await saveSettings(settings, config);
      setSettings(next); setSaved(config);
      setNotice('已保存。商城下一次购物车操作将读取新配置。');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }
  async function selectProducts(role: 'trigger' | 'gift') {
    if (!selected || busy || pickerPending.current) return;
    pickerPending.current = true;
    setPickerRole(role); setPickerError('');
    try {
      const result = await pickVariants(role === 'trigger' ? selected.triggerVariantIds : selected.gifts.map(gift => gift.variantId));
      if (result === undefined) return;
      setVariants(previous => ({ ...previous, ...result.products }));
      update(selected.id, role === 'trigger'
        ? { triggerVariantIds: result.ids }
        : { gifts: result.ids.map(variantId => ({ variantId })) });
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : '未能打开商品选择器，请重试。');
    } finally {
      pickerPending.current = false;
      setPickerRole(null);
    }
  }
  function names(ids: string[]) {
    const titles = [...new Set(ids.map(id => variants[id]?.product.title ?? `商品已删除或不可读取（${id}）`))];
    return titles.length ? `${titles.slice(0, 3).join('、')}${titles.length > 3 ? ` 等 ${titles.length} 款商品` : ''} · ${ids.length} 个变体` : '尚未选择';
  }

  return (
    <s-page heading="BOGO 买赠活动">
      <s-button slot="primary-action" variant="primary" disabled={disabled || !settings || (!!settings.shop.mode && !dirty)} loading={busy} onClick={() => void save()}>
        {settings?.shop.mode ? '保存活动配置' : '导入并启用页面管理'}
      </s-button>
      <s-stack gap="base">
        {error && <s-banner tone="critical"><s-paragraph>{error}</s-paragraph><s-button disabled={disabled} onClick={() => { setBusy(true); setPickerError(''); setLoadAttempt(value => value + 1); }}>重新加载（放弃未保存修改）</s-button></s-banner>}
        {notice && <s-banner tone="success">{notice}</s-banner>}
        {busy && !settings && <s-section><s-spinner accessibilityLabel="正在加载活动" /></s-section>}
        {settings && <>
          <s-section heading="活动管理">
            <s-stack gap="base">
              {/* <s-paragraph>当前店铺：{settings.shop.myshopifyDomain}</s-paragraph> */}
              {!settings.shop.mode && <s-banner tone="info">这是第一次使用页面管理。先检查下面的活动，确认无误后点击右上角“导入并启用页面管理”。之后新增活动只需要在这里操作，不用改代码。</s-banner>}
              <s-paragraph>操作顺序很简单：新增活动 → 选择“买什么” → 选择“送什么” → 保存。</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" disabled={disabled} onClick={addCampaign}>新增一个买赠活动</s-button>
                <s-button disabled={disabled || !dirty} onClick={() => { setConfig(saved); setSelectedId(null); setRemoveId(null); setError(''); setPickerError(''); }}>放弃未保存的修改</s-button>
                <s-text color="subdued">{dirty ? '有修改还没保存' : '已保存'} · {configBytes(JSON.stringify(config))} / 10000 字节</s-text>
              </s-stack>
            </s-stack>
          </s-section>
          <s-section heading={`活动列表（${config.campaigns.length}）`}>
            {!config.campaigns.length ? <s-paragraph>暂无活动，点击“新增活动”选择商品。</s-paragraph> : <s-table>
              <s-table-header-row><s-table-header listSlot="primary">活动</s-table-header><s-table-header>主商品</s-table-header><s-table-header>赠品</s-table-header><s-table-header>状态</s-table-header><s-table-header>操作</s-table-header></s-table-header-row>
              <s-table-body>{config.campaigns.map(campaign => <s-table-row key={campaign.id}>
                <s-table-cell>{campaign.name || campaign.id}</s-table-cell>
                <s-table-cell>{names(campaign.triggerVariantIds)}</s-table-cell>
                <s-table-cell>{names(campaign.gifts.map(gift => gift.variantId))}</s-table-cell>
                <s-table-cell><s-badge tone={campaign.enabled ? 'success' : 'neutral'}>{campaign.enabled ? '启用' : '停用'}</s-badge></s-table-cell>
                <s-table-cell><s-button disabled={disabled} onClick={() => { setSelectedId(campaign.id); setRemoveId(null); setPickerError(''); }}>编辑</s-button></s-table-cell>
              </s-table-row>)}</s-table-body>
            </s-table>}
          </s-section>
          {selected && <s-section heading="设置这个买赠活动">
            <s-stack gap="base">
              <s-text-field label="1. 给活动起个名字" value={selected.name ?? selected.id} maxLength={100} disabled={disabled} onInput={event => update(selected.id, { name: event.currentTarget.value })} />
              <s-text color="subdued">这个名字只给你自己看，不会显示给顾客。</s-text>
              <s-switch label="启用这个活动" checked={selected.enabled} disabled={disabled} onChange={event => update(selected.id, { enabled: event.currentTarget.checked })} />
              <s-switch label="显示 FREE GIFT 标签" checked={selected.showLabel ?? true} disabled={disabled} onChange={event => update(selected.id, { showLabel: event.currentTarget.checked })} />
              <s-paragraph>这个开关只控制购物车赠品商品左上角的Free gift标签。关掉后只是不显示标签，赠品和折扣仍然照常生效。</s-paragraph>
              <s-select label="赠送数量" value={selected.triggerQuantity === undefined ? 'follow' : 'fixed'} disabled={disabled} onChange={event => update(selected.id, { triggerQuantity: event.currentTarget.value === 'fixed' ? 1 : undefined })}>
                <s-option value="follow">买几个主商品，就送几个赠品</s-option>
                <s-option value="fixed">无论买几个主商品，只送固定数量赠品</s-option>
              </s-select>
              {selected.triggerQuantity !== undefined && <s-number-field label="固定送几个赠品" value={String(selected.triggerQuantity)} min={1} step={1} disabled={disabled} onInput={event => update(selected.id, { triggerQuantity: Number(event.currentTarget.value) })} />}
              <s-paragraph>数量设置只影响购物车里加几个赠品，免单规则保持不变。</s-paragraph>
              {pickerError && <s-banner tone="critical">{pickerError}</s-banner>}
              <s-button disabled={disabled} loading={pickerRole === 'trigger'} onClick={() => void selectProducts('trigger')}>2. 选择买什么（主商品）</s-button>
              <VariantList ids={selected.triggerVariantIds} variants={variants} />
              <s-button disabled={disabled} loading={pickerRole === 'gift'} onClick={() => void selectProducts('gift')}>3. 选择送什么（赠品）</s-button>
              <VariantList ids={selected.gifts.map(gift => gift.variantId)} variants={variants} />
              <s-text type="strong">检查完上面内容后，点击页面右上角“保存活动配置”。不保存的话，修改不会生效。</s-text>
              {removeId === selected.id ? <s-stack direction="inline" gap="base">
                <s-button tone="critical" disabled={disabled} onClick={() => {
                  setConfig(previous => ({ ...previous, campaigns: previous.campaigns.filter(campaign => campaign.id !== selected.id) }));
                  setSelectedId(null); setRemoveId(null);
                }}>确定删除这个活动（保存后生效）</s-button>
                <s-button disabled={disabled} onClick={() => setRemoveId(null)}>先不删除</s-button>
              </s-stack> : <s-button tone="critical" disabled={disabled} onClick={() => setRemoveId(selected.id)}>删除这个活动</s-button>}
            </s-stack>
          </s-section>}
        </>}
      </s-stack>
    </s-page>
  );
}

function VariantList({ ids, variants }: { ids: string[]; variants: Record<string, Variant> }) {
  const [expanded, setExpanded] = useState(false);
  return <s-stack gap="small">
    {(expanded ? ids : ids.slice(0, 5)).map(id => {
      const item = variants[id];
      const image = item?.media.nodes[0]?.image;
      return <s-stack key={id} direction="inline" gap="base" alignItems="center">
        {image && <s-thumbnail src={image.url} alt={image.altText ?? item.product.title} />}
        <s-text>{item ? `${item.product.title} · ${item.title}` : `商品已删除或不可读取（${id}）`}</s-text>
      </s-stack>;
    })}
    {!ids.length && <s-text color="subdued">尚未选择商品</s-text>}
    {ids.length > 5 && <s-button variant="tertiary" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : `查看全部 ${ids.length} 个变体`}</s-button>}
  </s-stack>;
}
