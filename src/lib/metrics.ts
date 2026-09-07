import { log } from "@/lib/logger";

/** CloudWatch Embedded Metric Format (one line JSON). Sample high-volume paths yourself. */
export function emitMetric(name: string, value: number, unit = "Count", dims: Record<string, string> = {}) {
  const timestamp = Date.now();
  const dimensions = Object.keys(dims);
  const line = {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: "PharmaProcurement",
          Dimensions: dimensions.length ? [dimensions] : [[]],
          Metrics: [{ Name: name, Unit: unit }],
        },
      ],
    },
    [name]: value,
    ...dims,
  };
  log.info("metric", { metric: name, value, unit, ...dims });
  if (process.env.EMIT_EMF === "1") {
    console.log(JSON.stringify(line));
  }
}
