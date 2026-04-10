import * as Haptics from "expo-haptics";
import { Link, type Href } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowUpRight } from "lucide-react-native";
import { ScrollView as HorizontalScrollView, StyleSheet } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import {
  getFeaturedLibraryArticle,
  librarySections,
  type LibraryArticle,
} from "@/features/library/content";
import { Pressable, ScrollView, Text, View } from "@/tw";

const TAB_BAR_HEIGHT = 90;

function triggerHaptic() {
  if (process.env.EXPO_OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function FeaturedArticleCard({ article }: { article: LibraryArticle }) {
  const articleHref = {
    pathname: "/library/[slug]",
    params: { slug: article.slug },
  } as unknown as Href;

  return (
    <Link href={articleHref} asChild>
      <Pressable onPressIn={triggerHaptic} style={styles.featuredCard}>
        <LinearGradient
          colors={[article.accentColor, "#64BCFF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.featuredGradient}
        >
          <View style={styles.featuredOrbLarge} />
          <View style={styles.featuredOrbSmall} />
          <View style={styles.featuredCopy}>
            <Text style={styles.featuredEyebrow}>{article.eyebrow}</Text>
            <Text style={styles.featuredTitle}>{article.title}</Text>
            <Text style={styles.featuredSubtitle}>{article.subtitle}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.featuredMeta}>{article.category}</Text>
              <Text style={styles.featuredMeta}>•</Text>
              <Text style={styles.featuredMeta}>{article.readTime}</Text>
            </View>
          </View>
          <Text style={styles.featuredWatermark}>01</Text>
        </LinearGradient>
      </Pressable>
    </Link>
  );
}

function ArticleCard({ article }: { article: LibraryArticle }) {
  const articleHref = {
    pathname: "/library/[slug]",
    params: { slug: article.slug },
  } as unknown as Href;

  return (
    <Link href={articleHref} asChild>
      <Pressable onPressIn={triggerHaptic} style={styles.articleCard}>
        <View
          style={[
            styles.articleCardArtwork,
            { backgroundColor: article.accentSoftColor },
          ]}
        >
          <View
            style={[
              styles.articleCardAccent,
              { backgroundColor: article.accentColor },
            ]}
          />
          <Text style={styles.articleCardEyebrow}>{article.eyebrow}</Text>
        </View>
        <View style={styles.articleCardBody}>
          <Text style={styles.articleCardTitle}>{article.title}</Text>
          <Text numberOfLines={2} style={styles.articleCardSubtitle}>
            {article.description}
          </Text>
          <View style={styles.cardFooter}>
            <Text style={styles.cardFooterMeta}>{article.readTime}</Text>
            <ArrowUpRight size={16} color="rgba(60,60,67,0.45)" strokeWidth={2} />
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

export default function LibraryScreen() {
  const featuredArticle = getFeaturedLibraryArticle();

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.container}>
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>Library</Text>
            <Text style={styles.pageSubtitle}>
              How-tos, tutorials, and clear answers for the Seeker wallet.
            </Text>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Featured</Text>
              <Text style={styles.sectionDescription}>
                Start with the most useful setup guide.
              </Text>
            </View>
            <FeaturedArticleCard article={featuredArticle} />
          </View>

          {librarySections.map((section) => (
            <View key={section.title} style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionDescription}>
                  {section.description}
                </Text>
              </View>

              <HorizontalScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalContent}
              >
                {section.articles.map((article) => (
                  <ArticleCard key={article.slug} article={article} />
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
  pageHeader: {
    gap: 8,
  },
  pageTitle: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 32,
    letterSpacing: -0.7,
  },
  pageSubtitle: {
    color: "rgba(60,60,67,0.66)",
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    letterSpacing: -0.18,
    lineHeight: 22,
  },
  sectionBlock: {
    gap: 14,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionTitle: {
    color: "#000",
    fontFamily: "Geist_700Bold",
    fontSize: 24,
    letterSpacing: -0.45,
  },
  sectionDescription: {
    color: "rgba(60,60,67,0.56)",
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  featuredCard: {
    borderCurve: "continuous",
    borderRadius: 30,
    overflow: "hidden",
  },
  featuredGradient: {
    borderCurve: "continuous",
    borderRadius: 30,
    minHeight: 232,
    overflow: "hidden",
    padding: 22,
  },
  featuredCopy: {
    gap: 10,
    marginTop: "auto",
    maxWidth: "75%",
  },
  featuredEyebrow: {
    color: "rgba(255,255,255,0.78)",
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    letterSpacing: -0.12,
  },
  featuredTitle: {
    color: "#fff",
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    letterSpacing: -0.6,
    lineHeight: 31,
  },
  featuredSubtitle: {
    color: "rgba(255,255,255,0.84)",
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 21,
  },
  featuredMeta: {
    color: "rgba(255,255,255,0.82)",
    fontFamily: "Geist_500Medium",
    fontSize: 13,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  featuredWatermark: {
    bottom: -34,
    color: "rgba(255,255,255,0.18)",
    fontFamily: "Geist_700Bold",
    fontSize: 158,
    letterSpacing: -6,
    position: "absolute",
    right: -2,
  },
  featuredOrbLarge: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderCurve: "continuous",
    borderRadius: 999,
    height: 130,
    position: "absolute",
    right: -18,
    top: -12,
    width: 130,
  },
  featuredOrbSmall: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderCurve: "continuous",
    borderRadius: 999,
    height: 66,
    position: "absolute",
    right: 84,
    top: 32,
    width: 66,
  },
  horizontalContent: {
    gap: 12,
    paddingRight: 16,
  },
  articleCard: {
    backgroundColor: "#F2F2F7",
    borderCurve: "continuous",
    borderRadius: 26,
    overflow: "hidden",
    width: 214,
  },
  articleCardArtwork: {
    borderCurve: "continuous",
    borderRadius: 24,
    height: 132,
    margin: 10,
    overflow: "hidden",
    padding: 14,
  },
  articleCardAccent: {
    borderCurve: "continuous",
    borderRadius: 999,
    height: 120,
    opacity: 0.14,
    position: "absolute",
    right: -36,
    top: -24,
    width: 120,
  },
  articleCardEyebrow: {
    color: "rgba(0,0,0,0.58)",
    fontFamily: "Geist_600SemiBold",
    fontSize: 13,
    letterSpacing: -0.14,
  },
  articleCardBody: {
    gap: 10,
    paddingBottom: 14,
    paddingHorizontal: 14,
  },
  articleCardTitle: {
    color: "#000",
    fontFamily: "Geist_600SemiBold",
    fontSize: 18,
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  articleCardSubtitle: {
    color: "rgba(60,60,67,0.7)",
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 19,
  },
  cardFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardFooterMeta: {
    color: "rgba(60,60,67,0.54)",
    fontFamily: "Geist_500Medium",
    fontSize: 13,
  },
});
