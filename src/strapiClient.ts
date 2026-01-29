// src/strapiClient.ts
import axios, { AxiosInstance } from 'axios';
import { logger } from './logger';

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

if (!STRAPI_API_TOKEN) {
  logger.warn(
    'STRAPI_API_TOKEN is not set. Authenticated requests will fail.[web:64][web:66]',
  );
}

const client: AxiosInstance = axios.create({
  baseURL: `${STRAPI_URL}/api`,
  headers: STRAPI_API_TOKEN
    ? {
        Authorization: `Bearer ${STRAPI_API_TOKEN}`,
      }
    : {},
});

export interface ProFeature {
  id: number;
  documentId: string;
  feature_id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  locale: string;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: { pagination: PaginationMeta };
}

// Find any locale version by base feature_id (to get documentId)
export async function findDocumentByFeatureId(
  baseFeatureId: string,
): Promise<ProFeature | null> {
  const params = {
    'filters[feature_id][$eq]': baseFeatureId,
    'pagination[pageSize]': 1,
  };

  logger.info(`GET /pro-features?feature_id=${baseFeatureId}`);

  const res = await client.get<ListResponse<ProFeature>>('/pro-features', {
    params,
  });
  return res.data.data[0] ?? null;
}

// Create a new document (default locale)[web:46][web:154]
export async function createBaseDocument(data: {
  feature_id: string;
  name: string;
  locale: string;
}): Promise<ProFeature> {
  logger.info(
    `POST /pro-features (base) feature_id=${data.feature_id}, locale=${data.locale}`,
  );

  const res = await client.post<{ data: ProFeature }>('/pro-features', {
    data,
  });
  return res.data.data;
}

// Create/update a specific locale version on an existing document[web:46][web:154]
export async function upsertLocaleVersion(
  documentId: string,
  locale: string,
  data: { name: string },
): Promise<ProFeature> {
  logger.info(
    `PUT /pro-features/${documentId}?locale=${locale} (create/update locale version)`,
  );

  const res = await client.put<{ data: ProFeature }>(
    `/pro-features/${documentId}?locale=${locale}`,
    { data },
  );
  return res.data.data;
}
