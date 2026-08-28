import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { ClaudeSummary, TranscriptChunk, WithId } from '@/types'

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 11,
    fontFamily: 'Helvetica',
    lineHeight: 1.45,
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 6 },
  subtitle: { fontSize: 12, marginBottom: 4, color: '#444' },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8 },
  paragraph: { marginBottom: 8 },
  listItem: { marginBottom: 4, paddingLeft: 8 },
  quote: {
    marginBottom: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#5b3aee',
    fontStyle: 'italic',
  },
  transcriptLine: { marginBottom: 4, fontSize: 9 },
})

export type SessionPdfProps = {
  showName: string
  sessionTitle: string
  scheduledLabel: string | null
  primaryColor: string
  summary: ClaudeSummary | null
  transcriptLines: string[]
}

export function SessionPdfDocument({
  showName,
  sessionTitle,
  scheduledLabel,
  summary,
  transcriptLines,
}: SessionPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.subtitle}>{showName}</Text>
        <Text style={styles.title}>{sessionTitle}</Text>
        {scheduledLabel ? <Text style={styles.subtitle}>{scheduledLabel}</Text> : null}

        {summary ? (
          <>
            <Text style={styles.sectionTitle}>Executive summary</Text>
            <Text style={styles.paragraph}>{summary.executiveSummary}</Text>

            {summary.keyTopics.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Key topics</Text>
                {summary.keyTopics.map((t) => (
                  <Text key={t} style={styles.listItem}>
                    • {t}
                  </Text>
                ))}
              </>
            ) : null}

            {summary.actionItems.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Action items</Text>
                {summary.actionItems.map((item) => (
                  <Text key={item} style={styles.listItem}>
                    • {item}
                  </Text>
                ))}
              </>
            ) : null}

            {summary.quotes.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Notable quotes</Text>
                {summary.quotes.map((q, i) => (
                  <View key={`${i}-${q.text.slice(0, 12)}`} style={styles.quote}>
                    {q.speaker ? <Text style={{ fontStyle: 'normal' }}>{q.speaker}</Text> : null}
                    <Text>“{q.text}”</Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.paragraph}>No AI summary available.</Text>
        )}
      </Page>

      {transcriptLines.length > 0 ? (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionTitle}>Full transcript</Text>
          {transcriptLines.map((line, i) => (
            <Text key={i} style={styles.transcriptLine}>
              {line}
            </Text>
          ))}
        </Page>
      ) : null}
    </Document>
  )
}

export function buildTranscriptLines(chunks: WithId<TranscriptChunk>[]): string[] {
  return [...chunks]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map((c) => {
      const prefix = c.speakerLabel ? `${c.speakerLabel}: ` : ''
      return `${prefix}${c.text}`
    })
}
