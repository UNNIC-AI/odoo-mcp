export interface OdooConfig {
  url: string;
  db: string;
  uid: number;
  password: string; // API key or user password
}

export type OdooDomain = Array<string | [string, string, unknown]>;

export interface SearchParams {
  model: string;
  domain?: OdooDomain;
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

export interface ReadParams {
  model: string;
  ids: number[];
  fields?: string[];
}

export interface CreateParams {
  model: string;
  values: Record<string, unknown>;
}

export interface UpdateParams {
  model: string;
  ids: number[];
  values: Record<string, unknown>;
}

export interface DeleteParams {
  model: string;
  ids: number[];
}

export interface CountParams {
  model: string;
  domain?: OdooDomain;
}

export interface FieldsParams {
  model: string;
  attributes?: string[];
}
