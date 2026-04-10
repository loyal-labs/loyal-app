import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native";

import { getLibraryArticleBySlug } from "@/features/library/content";
import { ScrollView, Text, View } from "@/tw";

export default function LibraryArticleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const article = getLibraryArticleBySlug(slug);

  if (!article) {
    return (
      <>
        <Stack.Screen options={{ title: "Library" }} />
        <View className="flex-1 bg-white items-center justify-center px-6">
          <Text style={styles.missingTitle}>Article not found</Text>
          <Text style={styles.missingBody}>
            This mock article does not exist in the current library dataset.
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: article.category }} />
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.container}>
          <View
            style={[
              styles.hero,
              { backgroundColor: article.accentSoftColor },
            ]}
          >
            <Text style={styles.eyebrow}>{article.eyebrow}</Text>
            <Text style={styles.title}>{article.title}</Text>
            <Text style={styles.subtitle}>{article.subtitle}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{article.category}</Text>
              <Text style={styles.metaDot}>•</Text>
              <Text style={styles.metaText}>{article.readTime}</Text>
              <Text style={styles.metaDot}>•</Text>
              <Text style={styles.metaText}>{article.updatedAtLabel}</Text>
            </View>
          </View>

          {article.sections.map((section) => (
            <View key={section.heading} style={styles.section}>
              <Text style={styles.sectionHeading}>{section.heading}</Text>
              <View style={styles.paragraphGroup}>
                {section.paragraphs.map((paragraph) => (
                  <Text key={paragraph} style={styles.bodyText}>
                    {paragraph}
                  </Text>
                ))}
              </View>
              {section.callout ? (
                <View style={styles.callout}>
                  <Text style={styles.calloutLabel}>Note</Text>
                  <Text style={styles.calloutText}>{section.callout}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: 40,
  },
  container: {
    gap: 28,
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  hero: {
    borderCurve: "continuous",
    borderRadius: 28,
    gap: 10,
    padding: 22,
  },
  eyebrow: {
    color: "rgba(0,0,0,0.52)",
    fontFamily: "Geist_600SemiBold",
    fontSize: 13,
    letterSpacing: -0.15,
    textTransform: "uppercase",
  },
  title: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 32,
    letterSpacing: -0.72,
    lineHeight: 36,
  },
  subtitle: {
    color: "rgba(60,60,67,0.72)",
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    letterSpacing: -0.22,
    lineHeight: 24,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 2,
  },
  metaText: {
    color: "rgba(60,60,67,0.6)",
    fontFamily: "Geist_500Medium",
    fontSize: 13,
  },
  metaDot: {
    color: "rgba(60,60,67,0.34)",
    fontFamily: "Geist_500Medium",
    fontSize: 13,
  },
  section: {
    gap: 12,
  },
  sectionHeading: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 24,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  paragraphGroup: {
    gap: 12,
  },
  bodyText: {
    color: "rgba(28,28,30,0.9)",
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    letterSpacing: -0.2,
    lineHeight: 26,
  },
  callout: {
    backgroundColor: "#F2F2F7",
    borderCurve: "continuous",
    borderRadius: 22,
    gap: 6,
    padding: 16,
  },
  calloutLabel: {
    color: "rgba(60,60,67,0.55)",
    fontFamily: "Geist_600SemiBold",
    fontSize: 12,
    letterSpacing: -0.08,
    textTransform: "uppercase",
  },
  calloutText: {
    color: "rgba(28,28,30,0.88)",
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 22,
  },
  missingTitle: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 24,
    letterSpacing: -0.3,
  },
  missingBody: {
    color: "rgba(60,60,67,0.6)",
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
    textAlign: "center",
  },
});
