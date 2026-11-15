import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  label: string;
  allLabel: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
  className?: string;
}

export function FilterSelect({ label, allLabel, value, options, onChange, className = 'w-full lg:w-40' }: Props) {
  return (
    <Select value={value ?? 'ALL'} onValueChange={(v) => onChange(v === 'ALL' ? undefined : v)}>
      <SelectTrigger aria-label={label} className={className}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}