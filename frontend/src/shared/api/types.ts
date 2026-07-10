/** 为业务组件导出 OpenAPI Schema 的简短别名，不重新定义传输对象。 */
import type { components } from './schema';

export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];
export type User = Schema<'User'>;
export type Role = Schema<'Role'>;
export type Product = Schema<'Product'>;
export type ProductFactsDraft = Schema<'ProductFactsDraft'>;
export type FactVersion = Schema<'FactVersion'>;
export type QueryTopic = Schema<'QueryTopic'>;
export type PlatformProfile = Schema<'PlatformProfile'>;
export type ContentTask = Schema<'ContentTask'>;
export type GenerationJob = Schema<'GenerationJob'>;
export type ContentVersion = Schema<'ContentVersion'>;
export type PublicationRecord = Schema<'PublicationRecord'>;
export type GeoObservation = Schema<'GeoObservation'>;
export type FileRecord = Schema<'FileRecord'>;
