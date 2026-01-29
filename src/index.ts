import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  createBaseDocument,
  findDocumentByFeatureId,
  upsertLocaleVersion,
  ProFeature,
} from './strapiClient';
import { logger } from './logger';

interface CsvRow {
  [key: string]: string;
}

interface ReportEntrySuccess {
  featureId: string; // base feature_id from CSV
  locale: string;
  action: 'create-base' | 'update-base' | 'upsert-locale';
  documentId: string;
  name: string;
}

interface ReportEntryFailure {
  featureId: string;
  locale: string;
  action: 'create-base' | 'update-base' | 'upsert-locale';
  error: string;
  row: CsvRow;
}

interface SyncReport {
  defaultLocale: string;
  otherLocales: string[];
  processedRows: number;
  successes: ReportEntrySuccess[];
  failures: ReportEntryFailure[];
}

function ensureReportsDir() {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  return reportsDir;
}

function formatError(err: any): string {
  if (err?.response) {
    const data = err.response.data;
    if (data?.error) {
      const e = data.error;
      return `${e.name || 'Error'}: ${e.message || JSON.stringify(e)}`;
    }
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function processCsv(filePath: string) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    logger.error(`CSV file not found: ${absPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(absPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  if (records.length === 0) {
    logger.warn('CSV has no rows.');
    return;
  }

  const headers = Object.keys(records[0]);
  if (headers.length < 2 || headers[0] !== 'feature_id') {
    logger.error(
      'CSV must have at least columns: feature_id,en,... and feature_id must be first column.',
    );
    process.exit(1);
  }

  const defaultLocale = headers[1]; // e.g. 'en'
  const otherLocales = headers.slice(2); // e.g. ['vi', 'fr', 'ru', 'zh-Hant']

  logger.info(
    `Default locale: ${defaultLocale}, other locales: ${
      otherLocales.join(', ') || '(none)'
    }`,
  );

  const report: SyncReport = {
    defaultLocale,
    otherLocales,
    processedRows: 0,
    successes: [],
    failures: [],
  };

  for (const row of records) {
    const baseFeatureId = row['feature_id'];
    if (!baseFeatureId) {
      logger.warn('Skipping row without feature_id');
      report.failures.push({
        featureId: '',
        locale: defaultLocale,
        action: 'create-base',
        error: 'Missing feature_id',
        row,
      });
      continue;
    }

    const baseName = row[defaultLocale];
    if (!baseName) {
      logger.warn(
        `Skipping feature_id=${baseFeatureId} because default locale "${defaultLocale}" name is empty`,
      );
      report.failures.push({
        featureId: baseFeatureId,
        locale: defaultLocale,
        action: 'create-base',
        error: `Missing name for default locale "${defaultLocale}"`,
        row,
      });
      continue;
    }

    logger.info(`\n=== Processing feature_id="${baseFeatureId}" ===`);

    let baseDoc: ProFeature | null = null;
    let documentId: string;

    // 1) Ensure base document (default locale) exists
    try {
      const existing = await findDocumentByFeatureId(baseFeatureId);

      if (!existing) {
        logger.info(
          `No existing document. Creating base document feature_id=${baseFeatureId}, locale=${defaultLocale}`,
        );
        baseDoc = await createBaseDocument({
          feature_id: baseFeatureId,
          name: baseName,
          locale: defaultLocale,
        });
        documentId = baseDoc.documentId;
        report.successes.push({
          featureId: baseFeatureId,
          locale: defaultLocale,
          action: 'create-base',
          documentId,
          name: baseDoc.name,
        });
      } else {
        documentId = existing.documentId;
        logger.info(
          `Found existing documentId=${documentId}. Updating base locale=${defaultLocale}`,
        );
        const updatedBase = await upsertLocaleVersion(documentId, defaultLocale, {
          name: baseName,
        });
        report.successes.push({
          featureId: baseFeatureId,
          locale: defaultLocale,
          action: 'update-base',
          documentId,
          name: updatedBase.name,
        });
      }
    } catch (err: any) {
      const msg = formatError(err);
      logger.error(
        `Error processing base locale for feature_id=${baseFeatureId}: ${msg}`,
      );
      report.failures.push({
        featureId: baseFeatureId,
        locale: defaultLocale,
        action: 'create-base',
        error: msg,
        row,
      });
      // if base fails, skip locales
      continue;
    }

    // 2) Upsert locale versions for this documentId
    for (const locale of otherLocales) {
      const localizedName = row[locale];
      if (!localizedName) {
        logger.info(
          `Locale "${locale}" empty for feature_id=${baseFeatureId}, skipping.`,
        );
        continue;
      }

      try {
        const localized = await upsertLocaleVersion(documentId, locale, {
          name: localizedName,
        });
        report.successes.push({
          featureId: baseFeatureId,
          locale,
          action: 'upsert-locale',
          documentId,
          name: localized.name,
        });
      } catch (err: any) {
        const msg = formatError(err);
        logger.error(
          `Error processing locale=${locale} for feature_id=${baseFeatureId}: ${msg}`,
        );
        report.failures.push({
          featureId: baseFeatureId,
          locale,
          action: 'upsert-locale',
          error: msg,
          row,
        });
      }
    }

    report.processedRows += 1;
  }

  const reportsDir = ensureReportsDir();
  const reportFile = path.join(
    reportsDir,
    `pro-feature-sync-report-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`,
  );

  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  logger.info(`\nSync complete. Report written to: ${reportFile}`);
  logger.info(
    `Summary: processed=${report.processedRows}, success=${report.successes.length}, failures=${report.failures.length}`,
  );
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    logger.error('Usage: npm run sync -- <path-to-csv>');
    process.exit(1);
  }

  if (!process.env.STRAPI_API_TOKEN) {
    logger.warn(
      'STRAPI_API_TOKEN is not set. Set it to a Strapi API token with read/write on pro-features.[web:64][web:66]',
    );
  }

  await processCsv(csvPath);
}

main().catch((err) => {
  logger.error(
    `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
