import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { configBytes, type StoredCampaign, type StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import { initialConfig, loadSettings, loadVariants, saveSettings, searchVariants, type Settings, type Variant } from './api';

export default async () => { render(<App />, document.body); };
const empty: StoredConfig = { version: 1, campaigns: [] };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
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
    setSelectedId(id); setNotice('');
  }
  async function save() {
    if (!settings) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (config.campaigns.some(campaign => !campaign.name?.trim())) throw new Error('请填写每个活动的名称');
      const next = await saveSettings(settings, config);
      setSettings(next); setSaved(config);
      setNotice('已保存。商城下一次购物车操作将读取新配置，折扣仍由现有 BOGO 自动折扣执行。');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }
  function names(ids: string[]) {
    const titles = [...new Set(ids.map(id => variants[id]?.product.title ?? `商品已删除或不可读取（${id}）`))];
    return titles.length ? `${titles.slice(0, 3).join('、')}${titles.length > 3 ? ` 等 ${titles.length} 款商品` : ''} · ${ids.length} 个变体` : '尚未选择';
  }

  return (
    <s-page heading="BOGO 买赠活动">
      <s-button slot="primary-action" variant="primary" disabled={busy || !settings || pickerRole !== null || (!!settings.shop.mode && !dirty)} loading={busy} onClick={() => void save()}>
        {settings?.shop.mode ? '保存活动配置' : '导入并启用页面管理'}
      </s-button>
      <s-stack gap="base">
        {error && <s-banner tone="critical"><s-paragraph>{error}</s-paragraph><s-button disabled={busy} onClick={() => { setPickerRole(null); setLoadAttempt(value => value + 1); }}>重新加载（放弃未保存修改）</s-button></s-banner>}
        {notice && <s-banner tone="success">{notice}</s-banner>}
        {busy && !settings && <s-section><s-spinner accessibilityLabel="正在加载活动" /></s-section>}
        {settings && <>
          <s-section heading="活动管理">
            <s-stack gap="base">
              <s-paragraph>当前店铺：{settings.shop.myshopifyDomain}</s-paragraph>
              {!settings.shop.mode && <s-banner tone="info">尚未切换到页面管理。下方是该店铺现有活动的导入预览；点击“导入并启用页面管理”后生效。请先完成商城和 BOGO 折扣函数的首次版本更新。</s-banner>}
              <s-paragraph>选择主商品和赠品，沿用当前赠送规则。赠品售罄时仍按现有购物车逻辑处理；请保持 Shopify 中的 BOGO 自动折扣启用。</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button disabled={busy} onClick={addCampaign}>新增活动</s-button>
                <s-button disabled={busy || !dirty} onClick={() => { setConfig(saved); setSelectedId(null); setRemoveId(null); setError(''); }}>撤销未保存修改</s-button>
                <s-text color="subdued">{dirty ? '有未保存修改' : '配置已加载'} · {configBytes(JSON.stringify(config))} / 10000 字节</s-text>
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
                <s-table-cell><s-button disabled={busy} onClick={() => { setSelectedId(campaign.id); setRemoveId(null); setPickerRole(null); }}>编辑</s-button></s-table-cell>
              </s-table-row>)}</s-table-body>
            </s-table>}
          </s-section>
          {selected && <s-section heading="编辑活动">
            <s-stack gap="base">
              <s-text-field label="活动名称" value={selected.name ?? selected.id} maxLength={100} disabled={busy} onInput={event => update(selected.id, { name: event.currentTarget.value })} />
              <s-text color="subdued">活动 ID：{selected.id}</s-text>
              <s-switch label="启用活动" checked={selected.enabled} disabled={busy} onChange={event => update(selected.id, { enabled: event.currentTarget.checked })} />
              <s-switch label="显示 FREE GIFT 标签" checked={selected.showLabel ?? true} disabled={busy} onChange={event => update(selected.id, { showLabel: event.currentTarget.checked })} />
              <s-paragraph>控制赠品商品图上的 FREE GIFT 标签显示，不影响赠送数量或折扣。</s-paragraph>
              <s-select label="赠送数量规则" value={selected.triggerQuantity === undefined ? 'follow' : 'fixed'} disabled={busy} onChange={event => update(selected.id, { triggerQuantity: event.currentTarget.value === 'fixed' ? 1 : undefined })}>
                <s-option value="follow">赠品数量随主商品数量 1:1 变化</s-option>
                <s-option value="fixed">固定赠品数量</s-option>
              </s-select>
              {selected.triggerQuantity !== undefined && <s-number-field label="每种赠品的固定数量" value={String(selected.triggerQuantity)} min={1} step={1} disabled={busy} onInput={event => update(selected.id, { triggerQuantity: Number(event.currentTarget.value) })} />}
              <s-paragraph>固定数量控制购物车添加数量；结账免单额度继续按该活动主商品总量封顶，与当前折扣函数一致。</s-paragraph>
              <s-button disabled={busy} onClick={() => setPickerRole('trigger')}>选择主商品及变体</s-button>
              <VariantList ids={selected.triggerVariantIds} variants={variants} />
              <s-button disabled={busy} onClick={() => setPickerRole('gift')}>选择赠品及变体</s-button>
              <VariantList ids={selected.gifts.map(gift => gift.variantId)} variants={variants} />
              {pickerRole && <ProductSelector key={`${selected.id}-${pickerRole}`}
                initial={pickerRole === 'trigger' ? selected.triggerVariantIds : selected.gifts.map(gift => gift.variantId)}
                known={variants} onCancel={() => setPickerRole(null)}
                onSelect={(ids, products) => {
                  setVariants(previous => ({ ...previous, ...products }));
                  update(selected.id, pickerRole === 'trigger' ? { triggerVariantIds: ids } : { gifts: ids.map(variantId => ({ variantId })) });
                  setPickerRole(null);
                }} />}
              <s-paragraph>以上修改将在点击顶部“保存活动配置”后生效。</s-paragraph>
              {removeId === selected.id ? <s-stack direction="inline" gap="base">
                <s-button tone="critical" disabled={busy} onClick={() => {
                  setConfig(previous => ({ ...previous, campaigns: previous.campaigns.filter(campaign => campaign.id !== selected.id) }));
                  setSelectedId(null); setRemoveId(null);
                }}>确认移除此活动，保存后生效</s-button>
                <s-button onClick={() => setRemoveId(null)}>取消移除</s-button>
              </s-stack> : <s-button tone="critical" disabled={busy} onClick={() => setRemoveId(selected.id)}>移除活动</s-button>}
            </s-stack>
          </s-section>}
        </>}
      </s-stack>
    </s-page>
  );
}

function ProductSelector({ initial, known, onCancel, onSelect }: {
  initial: string[]; known: Record<string, Variant>; onCancel: () => void;
  onSelect: (ids: string[], products: Record<string, Variant>) => void;
}) {
  const [search, setSearch] = useState('');
  const [request, setRequest] = useState<{ search: string; after: string | null }>({ search: '', after: null });
  const [products, setProducts] = useState<Variant[]>([]);
  const [details, setDetails] = useState(known);
  const [ids, setIds] = useState(initial);
  const [page, setPage] = useState<{ hasNextPage: boolean; endCursor: string | null }>({ hasNextPage: false, endCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    searchVariants(request.search, request.after).then(result => {
      if (cancelled) return;
      setProducts(result.nodes); setPage(result.pageInfo);
      setDetails(previous => ({ ...previous, ...Object.fromEntries(result.nodes.map(item => [item.id.split('/').pop()!, item])) }));
    }).catch(cause => { if (!cancelled) setError(errorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request]);
  const shown = onlySelected ? ids : products.map(item => item.id.split('/').pop()!);
  return <s-section heading="选择商品变体">
    <s-stack gap="base">
      <s-search-field label="搜索商品或 SKU" value={search} onInput={event => setSearch(event.currentTarget.value)} />
      <s-stack direction="inline" gap="base">
        <s-button disabled={loading} onClick={() => { setRequest({ search, after: null }); setOnlySelected(false); }}>搜索</s-button>
        <s-button disabled={loading} onClick={() => setOnlySelected(value => !value)}>{onlySelected ? '查看搜索结果' : `查看已选（${ids.length}）`}</s-button>
        <s-button disabled={loading || onlySelected || !!error} onClick={() => setIds(previous => [...new Set([...previous, ...shown])])}>全选本页</s-button>
      </s-stack>
      {error && <s-banner tone="critical">{error}</s-banner>}
      {loading ? <s-spinner accessibilityLabel="正在搜索商品" /> : shown.map(id => {
        const item = details[id];
        const image = item?.media.nodes[0]?.image;
        return <s-stack key={id} direction="inline" gap="base" alignItems="center">
          {image && <s-thumbnail src={image.url} alt={image.altText ?? item.product.title} />}
          <s-checkbox label={item ? `${item.product.title} · ${item.title}` : `已选变体 ${id}`} checked={ids.includes(id)} onChange={event => {
            setIds(previous => event.currentTarget.checked ? [...new Set([...previous, id])] : previous.filter(value => value !== id));
          }} />
        </s-stack>;
      })}
      {!loading && !shown.length && <s-paragraph>没有匹配的商品变体。</s-paragraph>}
      {!onlySelected && <s-stack direction="inline" gap="base">
        <s-button disabled={loading || !request.after} onClick={() => setRequest({ search: request.search, after: null })}>回到第一页</s-button>
        <s-button disabled={loading || !!error || !page.hasNextPage} onClick={() => setRequest({ search: request.search, after: page.endCursor })}>下一页</s-button>
      </s-stack>}
      <s-stack direction="inline" gap="base">
        <s-button variant="primary" disabled={loading} onClick={() => onSelect(ids, details)}>确认选择（{ids.length}）</s-button>
        <s-button onClick={onCancel}>取消</s-button>
      </s-stack>
    </s-stack>
  </s-section>;
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
