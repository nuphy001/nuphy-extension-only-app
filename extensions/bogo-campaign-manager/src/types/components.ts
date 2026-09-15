import type { ComponentChildren, Ref } from 'preact';
import type { Settings } from './api';
import type { Catalog, StoredCampaign } from './campaign';

export type ConfirmationProps = {
  id: string;
  heading: string;
  action: string;
  onConfirm: () => void;
  children: ComponentChildren;
  overlayRef?: Ref<HTMLElementTagNameMap['s-modal']>;
};

export type ConfigurationStatusProps = {
  settings: Settings;
  state?: 'saved' | 'dirty' | 'new';
};

export type CampaignTableProps = Catalog & {
  campaigns: StoredCampaign[];
  disabled: boolean;
  now: number;
  onEdit: (campaign: StoredCampaign) => void;
};
