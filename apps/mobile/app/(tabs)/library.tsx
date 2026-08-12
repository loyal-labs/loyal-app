import * as Haptics from "expo-haptics";
import { Link, type Href } from "expo-router";
import {
  ActivityIndicator,
  ScrollView as HorizontalScrollView,
  RefreshControl,
  StyleSheet,
} from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import {
  LIBRARY_IMAGE_ASPECT,
  useLibraryContent,
  type LibraryArticle,
} from "@/features/library/content";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const TAB_BAR_HEIGHT = 90;
const FEATURED_CARD_WIDTH = 296;
const FEATURED_CARD_HEIGHT = Math.round(FEATURED_CARD_WIDTH / LIBRARY_IMAGE_ASPECT);
const ARTICLE_CARD_WIDTH = 184;
const ARTICLE_CARD_HEIGHT = Math.round(ARTICLE_CARD_WIDTH / LIBRARY_IMAGE_ASPECT);
const CARD_PLACEHOLDER = "#F2F2F7";

function triggerHaptic() {
  if (process.env.EXPO_OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function buildArticleHref(article: LibraryArticle): Href {
  return {
    pathname: "/library/[id]",
    params: { id: article.id },
  } as unknown as Href;
}

function FeaturedCard({ article }: { article: LibraryArticle }) {
  return (
    <Link href={buildArticleHref(article)} asChild>
      <Pressable onPressIn={triggerHaptic} style={styles.featuredCard}>
        <Image
          source={article.coverImageUrl}
          style={styles.featuredImage}
          transition={160}
          contentFit="cover"
          accessibilityLabel={article.title}
        />
      </Pressable>
    </Link>
  );
}

function ArticleCard({ article }: { article: LibraryArticle }) {
  return (
    <Link href={buildArticleHref(article)} asChild>
      <Pressable onPressIn={triggerHaptic} style={styles.articleCard}>
        <Image
          source={article.coverImageUrl}
          style={styles.articleImage}
          transition={160}
          contentFit="cover"
          accessibilityLabel={article.title}
        />
      </Pressable>
    </Link>
  );
}

export default function LibraryScreen() {
  const { content, isLoading, isRefreshing, error, refresh } =
    useLibraryContent();

  const visibleSections = content.sections.filter(
    (section) => section.articles.length > 0
  );
  const hasFeatured = content.featured.length > 0;
  const hasAnyContent = hasFeatured || visibleSections.length > 0;

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refresh} />
        }
      >
        <View style={styles.container}>
          <Text style={styles.pageTitle}>Library</Text>

          {isLoading && !hasAnyContent ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator />
            </View>
          ) : null}

          {!isLoading && error && !hasAnyContent ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyText}>
                Could not load the library. Check your connection and try again.
              </Text>
            </View>
          ) : null}

          {hasFeatured ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Featured</Text>
              <HorizontalScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalContent}
                snapToInterval={FEATURED_CARD_WIDTH + 12}
                decelerationRate="fast"
              >
                {content.featured.map((article) => (
                  <FeaturedCard key={article.id} article={article} />
                ))}
              </HorizontalScrollView>
            </View>
          ) : null}

          {visibleSections.map((section) => (
            <View key={section.id} style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <HorizontalScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalContent}
              >
                {section.articles.map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </HorizontalScrollView>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: TAB_BAR_HEIGHT + 42,
  },
  container: {
    gap: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pageTitle: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 32,
    letterSpacing: -0.7,
  },
  sectionBlock: {
    gap: 14,
  },
  sectionTitle: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 22,
    letterSpacing: -0.4,
  },
  horizontalContent: {
    gap: 12,
    paddingRight: 16,
  },
  featuredCard: {
    backgroundColor: CARD_PLACEHOLDER,
    borderCurve: "continuous",
    borderRadius: 30,
    height: FEATURED_CARD_HEIGHT,
    overflow: "hidden",
    width: FEATURED_CARD_WIDTH,
  },
  featuredImage: {
    height: "100%",
    width: "100%",
  },
  articleCard: {
    backgroundColor: CARD_PLACEHOLDER,
    borderCurve: "continuous",
    borderRadius: 26,
    height: ARTICLE_CARD_HEIGHT,
    overflow: "hidden",
    width: ARTICLE_CARD_WIDTH,
  },
  articleImage: {
    height: "100%",
    width: "100%",
  },
  loadingBlock: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyBlock: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  emptyText: {
    color: "rgba(60,60,67,0.6)",
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
