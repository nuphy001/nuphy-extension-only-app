import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { configBytes, type StoredCampaign, type StoredConfig } from '../../nuphy-free-gift-discount/src/configuration';
import { initialConfig, loadProductByHandle, loadSettings, loadVariants, saveSettings, searchVariants, type Settings, type Variant } from './api';

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
  const pickerModal = useRef<HTMLElementTagNameMap['s-modal'] | null>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const selected = config.campaigns.find(campaign => campaign.id === selectedId);

  useEffect(() => {
    if (pickerRole) pickerModal.current?.showOverlay?.();
    else pickerModal.current?.hideOverlay?.();
  }, [pickerRole]);

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
      const multiGift = config.campaigns.filter(campaign => campaign.gifts.length !== 1);
      if (multiGift.length) throw new Error(`每个活动只能选择一个赠品变体，请修改后再保存：${multiGift.map(campaign => campaign.name || campaign.id).join('、')}`);
      const next = await saveSettings(settings, config);
      setSettings(next); setSaved(config);
      setNotice('已保存。商城下一次购物车操作将读取新配置。');
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
              {/* <s-paragraph>当前店铺：{settings.shop.myshopifyDomain}</s-paragraph> */}
              {!settings.shop.mode && <s-banner tone="info">这是第一次使用页面管理。先检查下面的活动，确认无误后点击右上角“导入并启用页面管理”。之后新增活动只需要在这里操作，不用改代码。</s-banner>}
              <s-paragraph>操作顺序很简单：新增活动 → 选择“买什么” → 选择“送什么” → 保存。</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" disabled={busy} onClick={addCampaign}>新增一个买赠活动</s-button>
                <s-button disabled={busy || !dirty} onClick={() => { setConfig(saved); setSelectedId(null); setRemoveId(null); setError(''); }}>放弃未保存的修改</s-button>
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
                <s-table-cell><s-button disabled={busy} onClick={() => { setSelectedId(campaign.id); setRemoveId(null); setPickerRole(null); }}>编辑</s-button></s-table-cell>
              </s-table-row>)}</s-table-body>
            </s-table>}
          </s-section>
          {selected && <s-section heading="设置这个买赠活动">
            <s-stack gap="base">
              <s-text-field label="1. 给活动起个名字" value={selected.name ?? selected.id} maxLength={100} disabled={busy} onInput={event => update(selected.id, { name: event.currentTarget.value })} />
              <s-text color="subdued">这个名字只给你自己看，不会显示给顾客。</s-text>
              <s-switch label="启用这个活动" checked={selected.enabled} disabled={busy} onChange={event => update(selected.id, { enabled: event.currentTarget.checked })} />
              <s-switch label="显示 FREE GIFT 标签" checked={selected.showLabel ?? true} disabled={busy} onChange={event => update(selected.id, { showLabel: event.currentTarget.checked })} />
              <s-paragraph>这个开关只控制购物车赠品商品左上角的Free gift标签。关掉后只是不显示标签，赠品和折扣仍然照常生效。</s-paragraph>
              <s-select label="赠送数量" value={selected.triggerQuantity === undefined ? 'follow' : 'fixed'} disabled={busy} onChange={event => update(selected.id, { triggerQuantity: event.currentTarget.value === 'fixed' ? 1 : undefined })}>
                <s-option value="follow">买几个主商品，就送几个赠品</s-option>
                <s-option value="fixed">无论买几个主商品，只送固定数量赠品</s-option>
              </s-select>
              {selected.triggerQuantity !== undefined && <s-number-field label="固定送几个赠品" value={String(selected.triggerQuantity)} min={1} step={1} disabled={busy} onInput={event => update(selected.id, { triggerQuantity: Number(event.currentTarget.value) })} />}
              <s-paragraph>数量设置只影响购物车里加几个赠品，免单规则保持不变。</s-paragraph>
              <s-button disabled={busy} onClick={() => setPickerRole('trigger')}>2. 选择买什么（主商品）</s-button>
              <VariantList ids={selected.triggerVariantIds} variants={variants} />
              <s-button disabled={busy} onClick={() => setPickerRole('gift')}>3. 选择送什么（赠品，只能选一个变体）</s-button>
              <VariantList ids={selected.gifts.map(gift => gift.variantId)} variants={variants} />
              <s-modal ref={pickerModal} heading={pickerRole === 'trigger' ? '选择买什么' : '选择送什么（赠品只能选一个变体）'} size="large-100" accessibilityLabel="选择活动商品" onHide={() => setPickerRole(null)}>
                {pickerRole && <ProductSelector key={`${selected.id}-${pickerRole}`}
                  role={pickerRole}
                  initial={pickerRole === 'trigger' ? selected.triggerVariantIds : selected.gifts.map(gift => gift.variantId)}
                  known={variants} onCancel={() => setPickerRole(null)}
                  onSelect={(ids, products) => {
                    setVariants(previous => ({ ...previous, ...products }));
                    update(selected.id, pickerRole === 'trigger' ? { triggerVariantIds: ids } : { gifts: ids.map(variantId => ({ variantId })) });
                    setPickerRole(null);
                  }} />}
              </s-modal>
              <s-text type="strong">检查完上面内容后，点击页面右上角“保存活动配置”。不保存的话，修改不会生效。</s-text>
              {removeId === selected.id ? <s-stack direction="inline" gap="base">
                <s-button tone="critical" disabled={busy} onClick={() => {
                  setConfig(previous => ({ ...previous, campaigns: previous.campaigns.filter(campaign => campaign.id !== selected.id) }));
                  setSelectedId(null); setRemoveId(null);
                }}>确定删除这个活动（保存后生效）</s-button>
                <s-button onClick={() => setRemoveId(null)}>先不删除</s-button>
              </s-stack> : <s-button tone="critical" disabled={busy} onClick={() => setRemoveId(selected.id)}>删除这个活动</s-button>}
            </s-stack>
          </s-section>}
        </>}
      </s-stack>
    </s-page>
  );
}

function inStock(item: Variant | undefined) {
  // Admin API 不提供 Storefront 的 currentlyNotInStock/quantityAvailable 字段。
  // 赠品选择器已通过 productVariants(query: "available:true") 做服务端过滤；
  // 已保存的历史变体也必须继续显示，避免无法编辑旧活动。
  return true;
}

type VariantGroup = { key: string; title: string; image?: { url: string; altText: string | null }; ids: string[] };

function groupByProduct(ids: string[], details: Record<string, Variant>): VariantGroup[] {
  const groups: VariantGroup[] = [];
  const index = new Map<string, number>();
  for (const id of ids) {
    const item = details[id];
    const key = item?.product.id ?? `unknown-${id}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, groups.length);
      groups.push({
        key,
        title: item?.product.title ?? '商品已删除或不可读取',
        image: item?.media.nodes[0]?.image ?? undefined,
        ids: [id],
      });
    } else {
      groups[at].ids.push(id);
    }
  }
  return groups;
}

function ProductSelector({ role, initial, known, onCancel, onSelect }: {
  role: 'trigger' | 'gift'; initial: string[]; known: Record<string, Variant>; onCancel: () => void;
  onSelect: (ids: string[], products: Record<string, Variant>) => void;
}) {
  const single = role === 'gift';
  const [search, setSearch] = useState('');
  const [request, setRequest] = useState<{ search: string; after: string | null }>({ search: '', after: null });
  const [products, setProducts] = useState<Variant[]>([]);
  const [details, setDetails] = useState(known);
  const [ids, setIds] = useState(initial);
  const [page, setPage] = useState<{ hasNextPage: boolean; endCursor: string | null }>({ hasNextPage: false, endCursor: null });
  // Shopify 只给向前的游标，记录每页起点游标才能回退到上一页。
  const [pageTrail, setPageTrail] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    searchVariants(request.search, request.after, single).then(result => {
      if (cancelled) return;
      setProducts(result.nodes); setPage(result.pageInfo);
      setDetails(previous => ({ ...previous, ...Object.fromEntries(result.nodes.map(item => [item.id.split('/').pop()!, item])) }));
    }).catch(cause => { if (!cancelled) setError(errorMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request, single]);
  const shown = onlySelected ? ids : products.map(item => item.id.split('/').pop()!);
  const groups = groupByProduct(shown, details);
  const allExpanded = groups.length > 0 && groups.every(group => expandedGroups[group.key]);
  const giftInvalid = single && (ids.length !== 1 || !inStock(details[ids[0]]));
  const toggleGroup = (key: string) => setExpandedGroups(previous => ({ ...previous, [key]: !previous[key] }));
  const setAllGroups = (value: boolean) => setExpandedGroups(previous => {
    const next = { ...previous };
    for (const group of groups) next[group.key] = value;
    return next;
  });
  const check = (id: string, checked: boolean) => setIds(previous => checked
    ? (single ? [id] : [...new Set([...previous, id])])
    : previous.filter(value => value !== id));
  async function searchByHandle() {
    const handle = search.trim();
    if (!handle) return;
    setLoading(true); setError('');
    try {
      const variants = await loadProductByHandle(handle);
      if (!variants) throw new Error(`没有找到 Handle 为「${handle}」的商品，请检查后重试（Handle 是商品网址最后一段，如 nuphy-air75-v3）`);
      const nodes = single ? variants.filter(item => inStock(item)) : variants;
      setOnlySelected(false);
      setProducts(nodes); setPage({ hasNextPage: false, endCursor: null }); setPageTrail([null]);
      setDetails(previous => ({ ...previous, ...Object.fromEntries(nodes.map(item => [item.id.split('/').pop()!, item])) }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setLoading(false); }
  }
  // 顶部 / 底部各渲染一次（各自调用，避免复用同一个 vnode）。
  const pageNav = () => <>
    <s-button disabled={loading || !request.after} onClick={() => { setPageTrail([null]); setRequest({ search: request.search, after: null }); }}>回到第一页</s-button>
    <s-button disabled={loading || !!error || pageTrail.length <= 1} onClick={() => {
      const trail = pageTrail.slice(0, -1);
      setPageTrail(trail);
      setRequest({ search: request.search, after: trail[trail.length - 1] ?? null });
    }}>上一页</s-button>
    <s-button disabled={loading || !!error || !page.hasNextPage} onClick={() => {
      setPageTrail(trail => [...trail, page.endCursor]);
      setRequest({ search: request.search, after: page.endCursor });
    }}>下一页</s-button>
    <s-text color="subdued">{loading ? '加载中…' : `本页 ${products.length} 个变体`}</s-text>
  </>;
  return <s-section heading={initial.length ? '选择商品（已选商品会保留）' : '选择商品'}>
    <s-stack gap="base">
      <s-paragraph>搜索商品名称、SKU 或商品 Handle，勾选需要的商品变体，再点击“确认选择”。{single ? '赠品按主商品分组展示，点“展开”挑选具体变体。' : ''}</s-paragraph>
      {single && <s-banner tone="info">一个活动只能送一个赠品变体：点击其他变体会替换当前选择；无库存的变体不能作为赠品，搜索结果已自动过滤。</s-banner>}
      <s-search-field label="搜索商品或 SKU" value={search} onInput={event => setSearch(event.currentTarget.value)} />
      <s-stack direction="inline" gap="base">
        <s-button variant="primary" disabled={loading} onClick={() => { setPageTrail([null]); setRequest({ search, after: null }); setOnlySelected(false); }}>开始搜索</s-button>
        <s-button disabled={loading || !search.trim()} onClick={() => void searchByHandle()}>按 Handle 搜索</s-button>
        <s-button disabled={loading} onClick={() => setOnlySelected(value => !value)}>{onlySelected ? '回到搜索结果' : `只看已选（${ids.length}）`}</s-button>
        {!single && <s-button disabled={loading || onlySelected || !!error} onClick={() => setIds(previous => [...new Set([...previous, ...shown])])}>全选本页</s-button>}
        <s-button disabled={loading || !groups.length} onClick={() => setAllGroups(!allExpanded)}>{allExpanded ? '全部收起' : '全部展开'}</s-button>
        <s-button tone="critical" disabled={loading || ids.length === 0} onClick={() => setIds([])}>清空当前选择</s-button>
      </s-stack>
      {!onlySelected && <s-stack direction="inline" gap="base">{pageNav()}</s-stack>}
      <s-stack direction="inline" gap="base">
        <s-button variant="primary" disabled={loading || (single && giftInvalid)} onClick={() => onSelect(ids, details)}>确认选择（{ids.length} 个）</s-button>
        {single && ids.length !== 1 && <s-text color="subdued">赠品必须且只能选择一个变体</s-text>}
        {single && ids.length === 1 && !inStock(details[ids[0]]) && <s-text color="subdued">选中的赠品没有库存，请换一个</s-text>}
        <s-button disabled={loading || ids.length === 0} onClick={() => setIds([])}>取消全部选择</s-button>
        <s-button onClick={onCancel}>不保存这次选择</s-button>
      </s-stack>
      {error && <s-banner tone="critical">{error}</s-banner>}
      {loading ? <s-spinner accessibilityLabel="正在搜索商品" /> : <s-stack gap="base">
        {groups.map(group => {
          const expanded = !!expandedGroups[group.key];
          const selectedCount = group.ids.filter(id => ids.includes(id)).length;
          return <s-stack key={group.key} gap="small">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button variant="tertiary" onClick={() => toggleGroup(group.key)}>{expanded ? '收起' : `展开（${group.ids.length}）`}</s-button>
              {group.image && <s-thumbnail src={group.image.url} alt={group.image.altText ?? group.title} />}
              <s-text type="strong">{group.title}</s-text>
              <s-text color="subdued">已选 {selectedCount} / {group.ids.length} 个变体</s-text>
              {!single && <s-button variant="tertiary" disabled={loading} onClick={() => setIds(previous => [...new Set([...previous, ...group.ids])])}>全选本组</s-button>}
            </s-stack>
            {expanded && group.ids.map(id => {
              const item = details[id];
              const image = item?.media.nodes[0]?.image;
              return <s-stack key={id} direction="inline" gap="base" alignItems="center">
                {image && <s-thumbnail src={image.url} alt={image.altText ?? item?.product.title} />}
                <s-checkbox label={item ? `${item.product.title} · ${item.title}` : `已选变体 ${id}`}
                  checked={ids.includes(id)}
                  // 赠品模式下无库存变体禁止勾选，但已勾选的允许取消。
                  disabled={single && !inStock(item) && !ids.includes(id)}
                  onChange={event => check(id, event.currentTarget.checked)} />
                {!inStock(item) && <s-badge tone="warning">无库存</s-badge>}
              </s-stack>;
            })}
          </s-stack>;
        })}
        {!groups.length && <s-paragraph>{onlySelected ? '还没有选商品。' : single ? '没有找到有库存的商品，请换个关键词再搜。' : '没有找到商品，请换个关键词再搜。'}</s-paragraph>}
      </s-stack>}
      {!onlySelected && <s-stack direction="inline" gap="base">{pageNav()}</s-stack>}
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
