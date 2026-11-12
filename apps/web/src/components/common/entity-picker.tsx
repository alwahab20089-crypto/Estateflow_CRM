// src/components/common/entity-picker.tsx
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

export interface PickerOption { id: string; label: string; description?: string; data?: unknown }

interface EntityPickerProps {
  id: string;
  label: string; // accessible name
  value: string;
  valueLabel?: string;
  placeholder: string;
  search: (query: string) => Promise<PickerOption[]>;
  onChange: (id: string, option?: PickerOption) => void;
  allowClear?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

/** Server-side search combobox: nothing is preloaded, so it scales to large organizations. */
export function EntityPicker({ id, label, value, valueLabel, placeholder, search, onChange, allowClear, disabled, invalid }: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text, 250);
  const results = useQuery({ queryKey: ['api', 'picker', id, debounced], queryFn: () => search(debounced.trim()), enabled: open, staleTime: 30_000 });

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} aria-invalid={invalid || undefined} disabled={disabled} className="w-full justify-between font-normal">
            <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>{value ? (valueLabel ?? 'Selected') : placeholder}</span>
            <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Type to search…" value={text} onValueChange={setText} />
            <CommandList>
              {results.isLoading && <p className="px-3 py-2 text-sm text-muted-foreground" role="status">Searching…</p>}
              {results.isError && <p className="px-3 py-2 text-sm text-destructive" role="alert">Search failed. Try again.</p>}
              {!results.isLoading && !results.isError && <CommandEmpty>No results</CommandEmpty>}
              <CommandGroup>
                {(results.data ?? []).map((o) => (
                  <CommandItem key={o.id} value={o.id} onSelect={() => { onChange(o.id, o); setOpen(false); }}>
                    <Check className={o.id === value ? 'size-4' : 'size-4 opacity-0'} aria-hidden />
                    <span className="truncate">{o.label}</span>
                    {o.description && <span className="ml-auto truncate text-xs text-muted-foreground">{o.description}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowClear && value && !disabled && (
        <Button type="button" variant="ghost" size="icon" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange('')}><X /></Button>
      )}
    </div>
  );
}