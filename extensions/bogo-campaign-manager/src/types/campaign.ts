import type { StoredCampaign } from '../../../nuphy-free-gift-discount/src/configuration';
import type { PickerOptions, Product, ProductRole, Settings, Variant } from './api';

// 复用 Function 的配置契约，避免管理端和折扣端各自维护一份。
export type { StoredCampaign, StoredConfig, StoredTriggerProduct } from '../../../nuphy-free-gift-discount/src/configuration';

export type ScheduleFields = {
  start: 'now' | 'scheduled';
  startDate: string;
  startTime: string;
  hasEnd: boolean;
  endDate: string;
  endTime: string;
};

export type Issues = Partial<Record<'name' | 'trigger' | 'gift' | 'quantity' | 'schedule', string>>;
export type Editor = {
  base?: StoredCampaign;
  draft: StoredCampaign;
  schedule: ScheduleFields;
  initial: string;
  issues: Issues;
  giftPickerOptions?: PickerOptions;
};
export type Catalog = { products: Record<string, Product>; variants: Record<string, Variant> };
export type ValidationResult = { campaign?: StoredCampaign; issues: Issues };
export type PageData = Catalog & { settings: Settings };
export type Operation = 'load' | 'save' | 'import' | ProductRole;
export type PageState = {
  data: PageData | null;
  editor: Editor | null;
  operation: Operation | null;
  feedback: { tone: 'success' | 'critical'; text: string } | null;
};
