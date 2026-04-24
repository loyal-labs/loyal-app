import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import Markdown from "react-native-markdown-display";

import {
  findLibraryArticleById,
  findLibrarySiblings,
  LIBRARY_IMAGE_ASPECT,
  type LibraryArticle,
  useLibraryContent,
} from "@/features/library/content";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Image } from "@/tw/image";

export default function LibraryArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { content, isLoading, error } = useLibraryContent();
  const { width } = useWindowDimensions();
  const router = useRouter();

  const article = id ? findLibraryArticleById(content, id) : undefined;
  const siblings = id
    ? findLibrarySiblings(content, id)
    : { section: null, previous: null, next: null };
  const coverHeight = Math.round(width / LIBRARY_IMAGE_ASPECT);

  if (isLoading && !article) {
    return (
      <>
        <Stack.Screen options={{ title: "" }} />
        <View className="flex-1 bg-white items-center justify-center">
          <ActivityIndicator />
        </View>
      </>
    );
  }

  if (!article) {
    return (
      <>
        <Stack.Screen options={{ title: "Library" }} />
        <View className="flex-1 bg-white items-center justify-center px-6">
          <Text style={styles.missingTitle}>Article not found</Text>
          <Text style={styles.missingBody}>
            {error
              ? "Could not load the library. Check your connection and try again."
              : "This article is no longer available."}
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.contentContainer}
      >
        <Image
          source={article.coverImageUrl}
          style={[styles.cover, { height: coverHeight }]}
          transition={160}
          contentFit="cover"
          accessibilityLabel={article.title}
        />
        <View style={styles.body}>
          <Markdown style={markdownStyles}>{article.contentMarkdown}</Markdown>
        </View>
        {siblings.section && (siblings.previous || siblings.next) ? (
          <SiblingNav
            sectionTitle={siblings.section.title}
            previous={siblings.previous}
            next={siblings.next}
            onNavigate={(nextId) => router.replace(`/library/${nextId}`)}
          />
        ) : null}
      </ScrollView>
    </>
  );
}

function SiblingNav({
  sectionTitle,
  previous,
  next,
  onNavigate,
}: {
  sectionTitle: string;
  previous: LibraryArticle | null;
  next: LibraryArticle | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <View style={siblingStyles.container}>
      <Text style={siblingStyles.sectionLabel}>More in {sectionTitle}</Text>
      {previous ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Previous article: ${previous.title}`}
          onPress={() => onNavigate(previous.id)}
          style={({ pressed }) => [
            siblingStyles.card,
            pressed && siblingStyles.cardPressed,
          ]}
        >
          <ChevronLeft size={20} color="rgba(60,60,67,0.6)" strokeWidth={2} />
          <View style={siblingStyles.cardText}>
            <Text style={siblingStyles.direction}>Previous</Text>
            <Text style={siblingStyles.title} numberOfLines={2}>
              {previous.title}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {next ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Next article: ${next.title}`}
          onPress={() => onNavigate(next.id)}
          style={({ pressed }) => [
            siblingStyles.card,
            pressed && siblingStyles.cardPressed,
          ]}
        >
          <View style={siblingStyles.cardText}>
            <Text style={[siblingStyles.direction, siblingStyles.alignRight]}>
              Next
            </Text>
            <Text
              style={[siblingStyles.title, siblingStyles.alignRight]}
              numberOfLines={2}
            >
              {next.title}
            </Text>
          </View>
          <ChevronRight size={20} color="rgba(60,60,67,0.6)" strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const siblingStyles = StyleSheet.create({
  container: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  sectionLabel: {
    color: "rgba(60,60,67,0.6)",
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    letterSpacing: -0.08,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  card: {
    alignItems: "center",
    backgroundColor: "#F5F5F7",
    borderRadius: 16,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardPressed: {
    backgroundColor: "#ECECEF",
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  direction: {
    color: "rgba(60,60,67,0.6)",
    fontFamily: "Geist_500Medium",
    fontSize: 12,
    letterSpacing: -0.05,
    textTransform: "uppercase",
  },
  title: {
    color: "#000",
    fontFamily: "Geist_600SemiBold",
    fontSize: 15,
    letterSpacing: -0.15,
    lineHeight: 20,
  },
  alignRight: {
    textAlign: "right",
  },
});

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: 40,
  },
  cover: {
    backgroundColor: "#F2F2F7",
    width: "100%",
  },
  body: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
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

const markdownStyles = {
  body: {
    color: "rgba(28,28,30,0.92)",
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    letterSpacing: -0.18,
    lineHeight: 26,
  },
  heading1: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 8,
    marginTop: 8,
  },
  heading2: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 22,
    letterSpacing: -0.35,
    lineHeight: 28,
    marginBottom: 6,
    marginTop: 14,
  },
  heading3: {
    color: "#000",
    fontFamily: "Geist_600SemiBold",
    fontSize: 19,
    letterSpacing: -0.25,
    lineHeight: 24,
    marginBottom: 4,
    marginTop: 10,
  },
  paragraph: {
    marginBottom: 12,
    marginTop: 0,
  },
  strong: {
    fontFamily: "Geist_600SemiBold",
  },
  em: {
    fontStyle: "italic" as const,
  },
  link: {
    color: "#2094F3",
  },
  bullet_list: {
    marginBottom: 12,
  },
  ordered_list: {
    marginBottom: 12,
  },
  list_item: {
    flexDirection: "row" as const,
    marginBottom: 4,
  },
  code_inline: {
    backgroundColor: "#F2F2F7",
    borderRadius: 4,
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    paddingHorizontal: 4,
  },
  fence: {
    backgroundColor: "#F2F2F7",
    borderRadius: 12,
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    padding: 12,
  },
  blockquote: {
    backgroundColor: "#F7F7F8",
    borderLeftColor: "#C7C7CC",
    borderLeftWidth: 3,
    borderRadius: 10,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hr: {
    backgroundColor: "rgba(60,60,67,0.18)",
    height: 1,
    marginVertical: 16,
  },
  image: {
    borderRadius: 12,
    marginVertical: 12,
  },
};
