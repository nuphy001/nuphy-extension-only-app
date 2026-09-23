import type { PickerOptions, PickerProductSelection, Product, ProductRole, Variant } from './api';
import type { StoredCampaign } from './campaign';

export type ProductSelectionProps = {
  role: ProductRole;
  campaign: StoredCampaign;
  products: Record<string, Product>;
  variants: Record<string, Variant>;
  disabled: boolean;
  error?: string;
  onChange: (patch: Partial<StoredCampaign>) => void;
  options?: PickerOptions;
  onOptionsChange?: (options: PickerOptions) => void;
  onBrowse: (initial: PickerProductSelection[], search: string, options?: PickerOptions) => void;
  onRetry: (productId: string) => void;
};

export type ProductSummaryProps = Pick<ProductSelectionProps, 'role' | 'campaign' | 'products' | 'variants'>;
