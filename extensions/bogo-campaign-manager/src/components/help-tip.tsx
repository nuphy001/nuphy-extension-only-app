import type { ComponentChildren } from 'preact';

// 将说明关联到原生信息按钮，支持鼠标悬停和键盘聚焦。
export function HelpTip({ id, label, children }: { id: string; label: string; children: ComponentChildren }) {
  return <>
    <s-button icon="info" variant="tertiary" accessibilityLabel={label} interestFor={id} />
    <s-tooltip id={id}>{children}</s-tooltip>
  </>;
}
