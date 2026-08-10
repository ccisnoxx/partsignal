type ColumnRole =
  | 'primary'
  | 'status'
  | 'metadata'
  | 'numeric'
  | 'date'
  | 'actions';

type ActionTarget =
  | { href: string; command?: never }
  | { href?: never; command: string };

interface ActionConfirmation {
  title: string;
  description: string;
  confirmLabel?: string;
  intent?: 'default' | 'destructive';
}

type PrimaryRowAction = ActionTarget & {
  key: string;
  label: string;
  intent: 'primary';
  enabled: boolean;
  disabledReason?: string;
  confirmation?: never;
};

type OverflowRowAction =
  | (ActionTarget & {
      key: string;
      label: string;
      intent: 'secondary';
      enabled: boolean;
      disabledReason?: string;
      confirmation?: ActionConfirmation | 'custom';
    })
  | (ActionTarget & {
      key: string;
      label: string;
      intent: 'danger';
      enabled: boolean;
      disabledReason?: string;
      confirmation: ActionConfirmation | 'custom';
    });

type RowAction = PrimaryRowAction | OverflowRowAction;

type BulkAction =
  | {
      key: string;
      label: string;
      command: string;
      intent: 'secondary';
      enabled: boolean;
      disabledReason?: string;
      confirmation?: ActionConfirmation;
    }
  | {
      key: string;
      label: string;
      command: string;
      intent: 'danger';
      enabled: boolean;
      disabledReason?: string;
      confirmation: ActionConfirmation;
    };

type EmptyTableKind = 'empty' | 'filtered-empty' | 'error';

export type {
  ActionConfirmation,
  BulkAction,
  ColumnRole,
  EmptyTableKind,
  OverflowRowAction,
  PrimaryRowAction,
  RowAction,
};
