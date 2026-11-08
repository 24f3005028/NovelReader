import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Novel, RatingSummary, RedditDiscussion, DiscoveryFeed } from '@novelreader/shared';
import { s } from '../theme';
export function RatingPanel({
  novel,
  rating,
  onRate,
}: {
  novel: Novel;
  rating: RatingSummary;
  onRate: (value: number) => void;
}) {
  return (
    <View style={s.panel}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View>
          <Text style={s.heading}>
            {rating.average
              ? `${rating.average.toFixed(1)} / 5`
              : novel.communityRating
                ? `${novel.communityRating.toFixed(1)} / 5`
                : 'Rate this story'}
          </Text>
          <Text style={s.small}>
            {rating.count
              ? `${rating.count} reader ${rating.count === 1 ? 'rating' : 'ratings'}`
              : novel.communityRating
                ? 'Community score'
                : 'Be the first to leave a rating'}
          </Text>
        </View>
        <View style={[s.row, { gap: 7 }]}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Rate ${value} out of 5`}
              onPress={() => onRate(value)}
            >
              <Ionicons
                name={value <= (rating.userRating || 0) ? 'star' : 'star-outline'}
                size={25}
                color="#329eff"
              />
            </Pressable>
          ))}
        </View>
      </View>
      {Boolean(rating.userRating) && (
        <Text style={s.small}>Your rating: {rating.userRating} / 5 · Tap a star to update</Text>
      )}
    </View>
  );
}
export function DiscussionPanel({ threads }: { threads: RedditDiscussion[] }) {
  if (!threads.length) return null;
  return (
    <View style={s.panel}>
      <View style={s.row}>
        <Ionicons name="logo-reddit" size={20} color="#329eff" />
        <Text style={s.heading}>Readers are talking</Text>
      </View>
      {threads.slice(0, 4).map((thread) => (
        <Pressable key={thread.id} onPress={() => void Linking.openURL(thread.url)}>
          <Text style={s.link}>{thread.title} ↗</Text>
          <Text style={s.small}>r/{thread.subreddit}</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function DiscoveryShelves({
  feed,
  onOpen,
  renderCover,
}: {
  feed: DiscoveryFeed;
  onOpen: (n: Novel) => void;
  renderCover: (n: Novel) => React.ReactNode;
}) {
  const shelf = (
    items: Novel[],
    title: string,
    icon: 'trending-up' | 'logo-reddit' | 'sparkles',
    ranked = false,
  ) => (
    <View style={{ marginBottom: 25 }}>
      <View style={[s.row, { justifyContent: 'space-between', marginBottom: 14 }]}>
        <Text style={s.heading}>{title}</Text>
        <Ionicons name={icon} size={20} color="#329eff" />
      </View>
      {icon === 'logo-reddit' && (
        <Text style={[s.muted, { marginTop: -8, marginBottom: 14 }]}>
          Discover what readers are discussing.
        </Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[s.row, { flexWrap: 'nowrap', alignItems: 'flex-start', gap: 14 }]}>
          {items.map((n, i) => (
            <Pressable key={n.catalogKey || n.id} style={{ width: 112 }} onPress={() => onOpen(n)}>
              <View>
                {renderCover(n)}
                {ranked && (
                  <View style={styles.rank}>
                    <Text style={styles.rankText}>{String(i + 1).padStart(2, '0')}</Text>
                  </View>
                )}
              </View>
              <Text style={s.bookTitle} numberOfLines={2}>
                {n.title}
              </Text>
              {icon === 'logo-reddit' ? (
                <Text style={s.small}>
                  {n.redditMentions} {n.redditMentions === 1 ? 'discussion' : 'discussions'}
                </Text>
              ) : (
                Boolean(n.ratingAverage || n.communityRating) && (
                  <View style={[s.row, { gap: 4 }]}>
                    <Ionicons name="star" size={10} color="#329eff" />
                    <Text style={s.small}>
                      {(n.ratingAverage || n.communityRating)!.toFixed(1)}
                    </Text>
                  </View>
                )
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
  return (
    <>
      {feed.top10.length > 0 && shelf(feed.top10, 'The popular 10', 'trending-up', true)}
      {feed.reddit.length > 0 && shelf(feed.reddit, 'From Reddit', 'logo-reddit')}
    </>
  );
}
const styles = StyleSheet.create({
  rank: {
    position: 'absolute',
    bottom: 7,
    left: 7,
    backgroundColor: '#05070be6',
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: '#168bff77',
  },
  rankText: { fontSize: 20, fontWeight: '900', color: '#329eff', letterSpacing: -1 },
});
