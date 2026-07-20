/** 统一展示平台 Logo；外链图片不发送当前页面来源，加载失败时回退平台首字。 */
import { useState } from 'react';
import type { Schema } from '../api/types';

export function PlatformAvatar({ name, logo, size = 32 }: { name: string; logo: Schema<'PlatformLogo'> | null; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = logo?.url;
  return <span className="platform-avatar" style={{ width: size, height: size }} aria-hidden="true">
    {url && failedUrl !== url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : <span>{name.trim().charAt(0).toLocaleUpperCase('zh-CN')}</span>}
  </span>;
}
