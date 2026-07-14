import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

export type ReportSourceRow = {
  name: string;
  amount: number;
};

// AI-generated (Gemini), income-descriptive-only summary — see lib/ai/income-narrative.ts.
// Optional and additive: the caller (app/api/report/route.tsx) populates this only when
// generation succeeds, so a failed/rate-limited/slow AI call still lets the rest of the report
// render in full.
export type ReportNarrative = {
  text: string;
  stabilityRating: string;
  trendDirection: string;
  diversificationSummary: string;
};

export type ReportData = {
  generatedAt: Date;
  userName: string;
  rangeLabel: string;
  totalVerified: number;
  bySource: ReportSourceRow[];
  narrative?: ReportNarrative;
};

const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  badge: { fontSize: 9, fontWeight: 700, color: "#0f6b4f", backgroundColor: "#e3f5ee", padding: "4 8", borderRadius: 12 },
  title: { fontSize: 14, fontWeight: 700 },
  subtitle: { fontSize: 9, color: "#6b6b6b", marginTop: 2 },
  name: { fontSize: 20, fontWeight: 700, marginTop: 24 },
  meta: { fontSize: 10, color: "#6b6b6b", marginTop: 4 },
  divider: { borderTopWidth: 1, borderTopColor: "#e5e0d8", marginTop: 20, paddingTop: 20 },
  label: { fontSize: 9, color: "#6b6b6b" },
  total: { fontSize: 26, fontWeight: 700, marginTop: 4 },
  sectionLabel: { fontSize: 9, fontWeight: 700, color: "#6b6b6b", letterSpacing: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  rowLabel: { fontSize: 11 },
  rowValue: { fontSize: 11, fontWeight: 700 },
  certificate: { marginTop: 20, backgroundColor: "#e3f5ee", padding: 14, borderRadius: 6 },
  certificateTitle: { fontSize: 10, fontWeight: 700, color: "#0f6b4f" },
  certificateBody: { fontSize: 9, color: "#3a3a3a", marginTop: 4 },
  narrativeText: { fontSize: 10, color: "#1a1a1a", marginTop: 8, lineHeight: 1.4 },
  narrativeMeta: { fontSize: 9, fontWeight: 700, color: "#6b6b6b", marginTop: 8 },
  narrativeDisclaimer: { fontSize: 8, color: "#8a8a8a", marginTop: 8 },
});

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * A parallel re-implementation of components/landing/report-mockup.tsx's visual content using
 * react-pdf's own layout primitives (View/Text/StyleSheet) rather than DOM/Tailwind — react-pdf
 * renders to actual PDF drawing operations, so the HTML mockup component can't be reused directly.
 */
export function ReportDocument({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Verified Income Report</Text>
            <Text style={styles.subtitle}>Veriq · verify.veriq.com</Text>
          </View>
          <Text style={styles.badge}>Verified</Text>
        </View>

        <Text style={styles.name}>{data.userName}</Text>
        <Text style={styles.meta}>
          {data.rangeLabel} · {data.bySource.length} {data.bySource.length === 1 ? "source" : "sources"} · Generated{" "}
          {DATE_FORMAT.format(data.generatedAt)}
        </Text>

        <View style={styles.divider}>
          <Text style={styles.label}>Total verified income</Text>
          <Text style={styles.total}>{CURRENCY.format(data.totalVerified)}</Text>
        </View>

        <View style={styles.divider}>
          <Text style={styles.sectionLabel}>INCOME BY SOURCE</Text>
          {data.bySource.map((source) => (
            <View key={source.name} style={styles.row}>
              <Text style={styles.rowLabel}>{source.name}</Text>
              <Text style={styles.rowValue}>{CURRENCY.format(source.amount)}</Text>
            </View>
          ))}
        </View>

        {data.narrative ? (
          <View style={styles.divider}>
            <Text style={styles.sectionLabel}>AI INCOME SUMMARY</Text>
            <Text style={styles.narrativeText}>{data.narrative.text}</Text>
            <Text style={styles.narrativeMeta}>
              Stability: {capitalize(data.narrative.stabilityRating)} · Trend: {capitalize(data.narrative.trendDirection)}
            </Text>
            <Text style={styles.narrativeText}>{data.narrative.diversificationSummary}</Text>
            <Text style={styles.narrativeDisclaimer}>
              AI-generated description of the verified income shown above. Not a credit score,
              creditworthiness assessment, or financial advice.
            </Text>
          </View>
        ) : null}

        <View style={styles.certificate}>
          <Text style={styles.certificateTitle}>Verification certificate</Text>
          <Text style={styles.certificateBody}>
            Each deposit verified against its originating source. Generated by Veriq for {data.userName}.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
