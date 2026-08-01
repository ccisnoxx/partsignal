/** 记录浮层触发元素，并在浮层关闭后把焦点安全返回原位置。 */
import {
  useCallback,
  useRef,
  type FocusEventHandler,
  type PointerEventHandler,
} from 'react';

/** 登记真实触发器，并在浮层关闭后消费该目标。 */
export function useFocusReturn() {
  const targetRef = useRef<HTMLElement | null>(null);
  const rememberFocusTarget = useCallback((target: HTMLElement) => {
    targetRef.current = target;
  }, []);
  const onFocus = useCallback<FocusEventHandler<HTMLElement>>((event) => {
    rememberFocusTarget(event.currentTarget);
  }, [rememberFocusTarget]);
  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    rememberFocusTarget(event.currentTarget);
  }, [rememberFocusTarget]);
  const restoreFocus = useCallback(() => {
    const target = targetRef.current;
    targetRef.current = null;
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
  }, []);

  return {
    focusReturnTargetProps: { onFocus, onPointerDown },
    rememberFocusTarget,
    restoreFocus,
  };
}
