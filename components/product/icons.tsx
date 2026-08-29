import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({ viewBox: "0 0 24 24", "aria-hidden": true, focusable: false, ...props });

export function HomeIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m4 11 8-7 8 7v9h-6v-6h-4v6H4Z" /></svg>;
}

export function CheckinIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M5 5h14v11H9l-4 4Z" /><path d="M9 9h6M9 12h4" /></svg>;
}

export function PlanIcon(props: IconProps) {
  return <svg {...base(props)}><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
}

export function ShieldIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M12 3 5 6v5c0 4.7 2.8 8.4 7 10 4.2-1.6 7-5.3 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
}

export function ArrowIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;
}

export function ClockIcon(props: IconProps) {
  return <svg {...base(props)}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>;
}

export function RuleIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M5 7h14M5 12h9M5 17h6" /><circle cx="17" cy="12" r="2" /></svg>;
}

export function BowlIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M4 10h16c0 5-3.2 8-8 8s-8-3-8-8Z" /><path d="M7 20h10M8 6c.5-1.3 1.5-2 3-2M13 7c.4-1.5 1.4-2.4 3-2.7" /></svg>;
}

export function MoonIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M19.5 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10 10.5Z" /></svg>;
}

export function MovementIcon(props: IconProps) {
  return <svg {...base(props)}><circle cx="12" cy="5" r="2" /><path d="m9 21 1.5-6-3-2 2-5 4 3 3.5.5M13.5 11 12 15l4 2 2 4" /></svg>;
}

export function MedicationIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m8 16 8-8M7.5 6.5a3.5 3.5 0 0 1 5 0l5 5a3.5 3.5 0 0 1-5 5l-5-5a3.5 3.5 0 0 1 0-5Z" /></svg>;
}

export function CareIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" /><path d="M8.5 12h2l1-2 1.5 4 1-2h1.5" /></svg>;
}

export function CheckIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m5 12 4 4L19 7" /></svg>;
}

export function UndoIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m8 8-4 4 4 4" /><path d="M5 12h8a6 6 0 0 1 6 6" /></svg>;
}

export function EditIcon(props: IconProps) {
  return <svg {...base(props)}><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" /><path d="m13.5 7 3.5 3.5" /></svg>;
}

export function TextIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M5 7h14M5 12h10M5 17h7" /></svg>;
}

export function PhotoIcon(props: IconProps) {
  return <svg {...base(props)}><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m6 17 4-4 3 3 2-2 3 3" /></svg>;
}

export function VoiceIcon(props: IconProps) {
  return <svg {...base(props)}><rect x="9" y="4" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6" /></svg>;
}

export function DocumentIcon(props: IconProps) {
  return <svg {...base(props)}><path d="M7 3h7l4 4v14H7Z" /><path d="M14 3v5h4M10 12h5M10 16h5" /></svg>;
}

export function InfoIcon(props: IconProps) {
  return <svg {...base(props)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}
