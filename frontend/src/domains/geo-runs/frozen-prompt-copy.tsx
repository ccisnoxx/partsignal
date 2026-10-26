import { useState } from 'react';
import { Button } from '@/design-system/primitives/button';

function FrozenPromptCopy({ promptText }: { promptText: string }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  async function copyPrompt() {
    setState('copying');
    try {
      await navigator.clipboard.writeText(promptText);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <Button
        className="min-h-11 sm:min-h-8"
        disabled={state === 'copying'}
        onClick={() => void copyPrompt()}
        type="button"
        variant="outline"
      >
        复制完整问题
      </Button>
      <p aria-live="polite" className="text-sm" role="status">
        {state === 'copying' && '正在复制完整问题…'}
        {state === 'copied' && '已复制本次运行的完整问题'}
        {state === 'failed' && '复制失败，请手动选择冻结问题原文'}
      </p>
    </>
  );
}

export { FrozenPromptCopy };
