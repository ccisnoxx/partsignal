/** 使用浏览器原生观察器标记当前进入阅读区的长页面章节。 */
import { useEffect, useState } from 'react';

const SECTION_OBSERVER_TOP_OFFSET = 148;

export function useActiveSection(sectionIds: readonly string[]) {
  const sectionKey = sectionIds.join('|');
  const [activeSection, setActiveSection] = useState<string | undefined>(sectionIds[0]);

  useEffect(() => {
    const ids = sectionKey ? sectionKey.split('|') : [];
    if (ids.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const elements = ids.map((id) => document.getElementById(id)).filter((element): element is HTMLElement => !!element);
    // 页面到底时最后章节无法再贴近顶栏，观察区需保留视口中部以正确标记末节。
    const observer = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top - SECTION_OBSERVER_TOP_OFFSET) - Math.abs(right.boundingClientRect.top - SECTION_OBSERVER_TOP_OFFSET))[0];
      if (current) setActiveSection(current.target.id);
    }, { rootMargin: `-${SECTION_OBSERVER_TOP_OFFSET}px 0px -50% 0px` });

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sectionKey]);

  return activeSection;
}
