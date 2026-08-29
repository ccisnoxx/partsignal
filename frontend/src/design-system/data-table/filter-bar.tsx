import { SearchIcon } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';

import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';

type FilterBarProps = {
  filters?: ReactNode;
  moreFilters?: ReactNode;
  onQueryChange: (value: string) => void;
  onReset: () => void;
  onSubmit: () => void;
  placeholder?: string;
  query: string;
  resetDisabled?: boolean;
  searchLabel?: string;
};

function FilterBar({
  filters,
  moreFilters,
  onQueryChange,
  onReset,
  onSubmit,
  placeholder = '搜索…',
  query,
  resetDisabled = false,
  searchLabel = '搜索表格',
}: FilterBarProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center" onSubmit={handleSubmit} role="search">
      <label className="relative block min-w-0 flex-1 md:max-w-sm">
        <span className="sr-only">{searchLabel}</span>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" />
        <Input
          aria-label={searchLabel}
          className="pl-8"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder={placeholder}
          type="search"
          value={query}
        />
      </label>
      {filters}
      {moreFilters}
      <div className="flex items-center gap-2">
        <Button type="submit">搜索</Button>
        <Button disabled={resetDisabled} onClick={onReset} type="button" variant="ghost">
          重置
        </Button>
      </div>
    </form>
  );
}

export { FilterBar };
export type { FilterBarProps };
