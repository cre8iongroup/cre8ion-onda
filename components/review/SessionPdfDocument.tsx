import {
  Document,
  Image,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_TEXT_COLOR,
} from '@/lib/branding'
import type { ClaudeSummary } from '@/types'

const HEADER_BG = DEFAULT_BACKGROUND_COLOR
const HEADER_TEXT = DEFAULT_TEXT_COLOR

export type SessionPdfProps = {
  showName: string
  sessionTitle: string
  scheduledLabel: string | null
  logoUrl?: string | null
  accentColor?: string
  summary: ClaudeSummary | null
}

export function SessionPdfDocument({
  showName,
  sessionTitle,
  scheduledLabel,
  logoUrl,
  accentColor = DEFAULT_PRIMARY_COLOR,
  summary,
}: SessionPdfProps) {
  const styles = StyleSheet.create({
    page: {
      fontSize: 11,
      fontFamily: 'Helvetica',
      lineHeight: 1.45,
    },
    header: {
      backgroundColor: HEADER_BG,
      paddingHorizontal: 40,
      paddingTop: 32,
      paddingBottom: 24,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    logo: {
      height: 44,
      maxWidth: 140,
      objectFit: 'contain',
    },
    headerText: {
      flex: 1,
    },
    showName: {
      fontSize: 10,
      marginBottom: 4,
      color: HEADER_TEXT,
    },
    title: {
      fontSize: 16,
      fontWeight: 700,
      marginBottom: 4,
      color: HEADER_TEXT,
    },
    scheduled: {
      fontSize: 10,
      color: HEADER_TEXT,
    },
    body: {
      paddingHorizontal: 48,
      paddingTop: 28,
      paddingBottom: 48,
      color: '#1a1a1a',
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: 700,
      marginTop: 16,
      marginBottom: 8,
      color: accentColor,
    },
    paragraph: { marginBottom: 8 },
    listItem: { marginBottom: 4, paddingLeft: 8 },
    quote: {
      marginBottom: 8,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderLeftColor: accentColor,
      fontStyle: 'italic',
    },
  })

  const trimmedLogo = logoUrl?.trim()

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {trimmedLogo ? <Image style={styles.logo} src={trimmedLogo} /> : null}
            <View style={styles.headerText}>
              <Text style={styles.showName}>{showName}</Text>
              <Text style={styles.title}>{sessionTitle}</Text>
              {scheduledLabel ? <Text style={styles.scheduled}>{scheduledLabel}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.body}>
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
        </View>
      </Page>
    </Document>
  )
}
