import type { ConfirmationProps } from '../types/components';

// 复用原生确认弹窗，点击确认后关闭弹窗并执行对应操作。
export function Confirmation({ id, heading, action, onConfirm, children, overlayRef }: ConfirmationProps) {
  return <s-modal ref={overlayRef} id={id} heading={heading}>
    <s-paragraph>{children}</s-paragraph>
    <s-button slot="primary-action" variant="primary" tone={id === 'import-confirm' ? 'auto' : 'critical'}
      commandFor={id} command="--hide" onClick={onConfirm}>{action}</s-button>
    <s-button slot="secondary-actions" commandFor={id} command="--hide">取消</s-button>
  </s-modal>;
}
