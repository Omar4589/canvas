import { Household } from '../../models/Household.js';
import { GeocodingJob } from '../../models/GeocodingJob.js';
import { buildBatchCsv, submitCensusBatch, parseCensusResponse } from './censusBatch.js';
import { geocodeAddressViaMapbox } from './mapboxFallback.js';

const CHUNK_SIZE = 1000;

async function persistChunkResults(households, results) {
  const resultMap = new Map(results.map((r) => [String(r.id), r]));
  let matched = 0;
  let failed = 0;
  const ops = [];
  for (const h of households) {
    const r = resultMap.get(String(h._id));
    if (r && r.matchStatus === 'Match' && r.lat != null && r.lng != null) {
      matched++;
      ops.push({
        updateOne: {
          filter: { _id: h._id },
          update: {
            $set: {
              location: { type: 'Point', coordinates: [r.lng, r.lat] },
              geocodeStatus: 'success',
              geocodeProvider: 'census',
              geocodeRaw: r,
            },
          },
        },
      });
    } else {
      failed++;
      ops.push({
        updateOne: {
          filter: { _id: h._id },
          update: { $set: { geocodeStatus: 'failed', geocodeRaw: r || null } },
        },
      });
    }
  }
  if (ops.length) await Household.bulkWrite(ops, { ordered: false });
  return { matched, failed };
}

export async function runCensusGeocoding(jobId) {
  const job = await GeocodingJob.findById(jobId);
  if (!job) return;
  try {
    job.status = 'running';
    job.startedAt = new Date();
    await job.save();

    const households = await Household.find({
      isActive: true,
      geocodeStatus: 'pending',
    }).limit(10000);

    job.totalHouseholds = households.length;
    await job.save();

    if (households.length === 0) {
      job.status = 'completed';
      job.completedAt = new Date();
      await job.save();
      return;
    }

    let matched = 0;
    let failed = 0;
    let processed = 0;
    const chunkErrors = [];

    for (let i = 0; i < households.length; i += CHUNK_SIZE) {
      const chunk = households.slice(i, i + CHUNK_SIZE);
      try {
        const csv = buildBatchCsv(chunk);
        const responseText = await submitCensusBatch(csv);
        const results = parseCensusResponse(responseText);
        const stats = await persistChunkResults(chunk, results);
        matched += stats.matched;
        failed += stats.failed;
      } catch (err) {
        // Mark this chunk's households as failed and continue
        console.error(`[geocoding] chunk ${i / CHUNK_SIZE} failed:`, err.message);
        chunkErrors.push({ chunkStart: i, reason: err.message });
        const chunkFailed = await persistChunkResults(chunk, []);
        failed += chunkFailed.failed;
      }
      processed += chunk.length;
      job.processedHouseholds = processed;
      job.matched = matched;
      job.failed = failed;
      await job.save();
    }

    job.errors = chunkErrors;
    job.status = 'completed';
    job.completedAt = new Date();
    await job.save();
  } catch (err) {
    console.error('[geocoding] census job failed', err);
    job.status = 'failed';
    job.errors = [{ reason: err.message }];
    job.completedAt = new Date();
    await job.save();
  }
}

export async function runMapboxFallback(jobId) {
  const job = await GeocodingJob.findById(jobId);
  if (!job) return;
  try {
    if (!process.env.MAPBOX_SECRET_TOKEN) {
      throw new Error('MAPBOX_SECRET_TOKEN not configured');
    }
    job.status = 'running';
    job.startedAt = new Date();
    await job.save();

    const households = await Household.find({
      isActive: true,
      geocodeStatus: 'failed',
    }).limit(10000);

    job.totalHouseholds = households.length;
    await job.save();

    if (households.length === 0) {
      job.status = 'completed';
      job.completedAt = new Date();
      await job.save();
      return;
    }

    let matched = 0;
    let failed = 0;
    let processed = 0;
    for (const h of households) {
      try {
        const r = await geocodeAddressViaMapbox(h);
        if (r && r.lat != null && r.lng != null) {
          matched++;
          await Household.updateOne(
            { _id: h._id },
            {
              $set: {
                location: { type: 'Point', coordinates: [r.lng, r.lat] },
                geocodeStatus: 'success',
                geocodeProvider: 'mapbox',
                geocodeRaw: r.raw,
              },
            }
          );
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        console.error('[geocoding] mapbox lookup failed for', h._id, err.message);
      }
      processed++;
      // Persist progress every 25 to keep status endpoint useful
      if (processed % 25 === 0) {
        job.processedHouseholds = processed;
        job.matched = matched;
        job.failed = failed;
        await job.save();
      }
    }

    job.processedHouseholds = processed;
    job.matched = matched;
    job.failed = failed;
    job.status = 'completed';
    job.completedAt = new Date();
    await job.save();
  } catch (err) {
    console.error('[geocoding] mapbox job failed', err);
    job.status = 'failed';
    job.errors = [{ reason: err.message }];
    job.completedAt = new Date();
    await job.save();
  }
}
