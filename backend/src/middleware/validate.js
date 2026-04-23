const { z } = require("zod");

const UploadBatchSchema = z.object({
  id: z.string().min(1).max(128),
  fileName: z.string().min(1).max(512),
  uploadedAt: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(z.record(z.string(), z.string())).default([]),
});

const BatchesSchema = z
  .object({
    standard: z.array(UploadBatchSchema).default([]),
    australia: z.array(UploadBatchSchema).default([]),
    updatedAt: z.string().optional().default(""),
  })
  .passthrough();

const SummarySchema = z
  .object({
    totalRows: z.number().optional(),
    totalPropertySF: z.number().optional(),
    totalTime: z.number().optional(),
    avgDraftRate: z.number().optional(),
    avgQER: z.number().optional(),
    avgL1: z.number().optional(),
    avgL2: z.number().optional(),
    avgL3: z.number().optional(),
    qaFiles: z.number().optional(),
    qaPropertySF: z.number().optional(),
    qaTime: z.number().optional(),
    avgQARate: z.number().optional(),
  })
  .passthrough();

const SnapshotSchema = z
  .object({
    generatedAt: z.string(),
    preset: z.string(),
    presetLabel: z.string(),
    summary: SummarySchema,
    teams: z.array(z.record(z.string(), z.any())).default([]),
    weeklyRows: z.array(z.record(z.string(), z.any())).default([]),
    presetDistribution: z.array(z.record(z.string(), z.any())).default([]),
  })
  .passthrough();

const CloudStateSchema = z.object({
  snapshot: SnapshotSchema.nullable().optional(),
  batches: BatchesSchema,
  updatedAt: z.string().optional(),
});

function validateCloudState(req, res, next) {
  const result = CloudStateSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: result.error.flatten(),
    });
  }
  req.body = result.data;
  next();
}

module.exports = { validateCloudState };
