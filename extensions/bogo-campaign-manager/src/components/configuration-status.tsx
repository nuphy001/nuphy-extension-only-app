import { configBytes, MAX_CONFIG_BYTES } from '../../../nuphy-free-gift-discount/src/configuration';
import type { ConfigurationStatusProps } from '../types/components';
import { HelpTip } from './help-tip';

// 统计整份已保存配置；未提交的草稿不计入用量，旧配置预览不标记为已保存。
export function ConfigurationStatus({ settings, state }: ConfigurationStatusProps) {
  const saved = settings.shop.mode?.value === 'managed' && settings.shop.config !== null;
  const bytes = saved ? configBytes(JSON.stringify(settings.shop.config?.jsonValue)) : 0;
  const pending = state === 'dirty' || state === 'new';
  const label = state === 'dirty' ? '有未保存的修改' : !saved || state === 'new' ? '尚未保存' : '已保存';

  return <s-stack direction="inline" gap="small-400" alignItems="center">
    <s-badge tone={pending ? 'warning' : 'neutral'}>{label}</s-badge>
    <s-text color="subdued">· {pending ? '已存 ' : ''}{bytes} / {MAX_CONFIG_BYTES} 字节</s-text>
    <HelpTip id="configuration-capacity-help" label="配置容量与保存范围说明">
      统计全部已保存活动的配置用量，不含当前未保存的修改。每次保存只更新当前活动。Shopify 折扣函数最多读取 {MAX_CONFIG_BYTES} 字节的配置，超过时需减少活动或商品规格。
    </HelpTip>
  </s-stack>;
}
