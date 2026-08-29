import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { getProductDeletionBlockerLabel, type ProductProjection } from './product.model';

type ProductDeletionConditionsDialogProps = {
  onClose: () => void;
  onRefresh: () => Promise<void>;
  open: boolean;
  product?: ProductProjection;
  refreshing: boolean;
};

function ProductDeletionConditionsDialog({
  onClose,
  onRefresh,
  open,
  product,
  refreshing,
}: ProductDeletionConditionsDialogProps) {
  const blockers = product?.deletion?.blockers ?? [];
  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>产品“{product?.part_number ?? ''}”暂时不能删除</DialogTitle>
          <DialogDescription>以下服务端权威引用需要先处理；当前页面不会自行推断或绕过删除条件。</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2" aria-label="删除条件">
          {blockers.map((blocker) => (
            <li className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2" key={blocker.type}>
              <span>{getProductDeletionBlockerLabel(blocker)}</span>
              <strong className="font-mono">{blocker.count}</strong>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button aria-label="关闭删除条件" variant="outline" />}>关闭</DialogClose>
          <Button disabled={refreshing} onClick={() => void onRefresh()} type="button">
            {refreshing ? '正在检查…' : '重新检查'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ProductDeletionConditionsDialog };
export type { ProductDeletionConditionsDialogProps };
