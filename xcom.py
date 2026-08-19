"""Standalone Python client for X.com's internal GraphQL API + ThreadReaderApp.

No server needed — uses guest token auth directly against api.x.com.
Thread unrolling uses ThreadReaderApp's JSON API for instant content,
with optional X GraphQL enrichment for engagement metrics and video URLs.
Post search uses an authenticated x.com web session supplied through
X_AUTH_TOKEN and X_CT0.

Requires: pip install requests curl_cffi
(curl_cffi is only needed for search; user/tweet/thread code uses plain requests.)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import textwrap
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import escape as _esc
from urllib.parse import quote

import requests

_API = "https://api.x.com"
_WEB_API = "https://x.com/i/api"
_BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
_TRA = "https://threadreaderapp.com"

# GraphQL query IDs (from X's client JS bundle — change when X updates)
# from main.27ea3f4a.js, verified 2026-08-07
_Q = {
    "UserByScreenName": "Gb-d6r0vxPOADdG62OEBpQ",
    "UserTweets": "T1x2zehUOKCWNpKwZCpnbg",
    "TweetResultByRestId": "oZDZmKdLaZObfAE9qC17Lg",
    "SearchTimeline": "PusO6nN_nUSAsfJktZJd9w",
}

_FEATURES = json.dumps({
    "rweb_video_screen_enabled": False,
    "profile_label_improvements_pcf_label_in_post_enabled": False,
    "rweb_tipjar_consumption_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": False,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "responsive_web_graphql_timeline_navigation_enabled": False,
})

_TWEET_FEATURES = json.dumps({
    **json.loads(_FEATURES),
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": True,
    "premium_content_api_read_enabled": True,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
})

_SEARCH_FEATURES = json.dumps({
    "rweb_video_screen_enabled": False,
    "rweb_cashtags_enabled": True,
    "profile_label_improvements_pcf_label_in_post_enabled": False,
    "responsive_web_profile_redirect_enabled": False,
    "rweb_tipjar_consumption_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "premium_content_api_read_enabled": True,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": True,
    "responsive_web_grok_analyze_post_followups_enabled": False,
    "rweb_cashtags_composer_attachment_enabled": False,
    "responsive_web_jetfuel_frame": False,
    "responsive_web_grok_share_attachment_enabled": False,
    "responsive_web_grok_annotations_enabled": False,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "rweb_conversational_replies_downvote_enabled": False,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "content_disclosure_indicator_enabled": True,
    "content_disclosure_ai_generated_indicator_enabled": True,
    "responsive_web_grok_show_grok_translated_post": False,
    "responsive_web_grok_analysis_button_from_backend": False,
    "post_ctas_fetch_enabled": True,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": False,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_grok_image_annotation_enabled": False,
    "responsive_web_grok_imagine_annotation_enabled": False,
    "responsive_web_grok_community_note_auto_translation_is_enabled": False,
    "responsive_web_enhance_cards_enabled": False,
})

_SEARCH_FIELD_TOGGLES = json.dumps({
    "withPayments": False,
    "withAuxiliaryUserLabels": True,
    "withArticleRichContentState": True,
    "withArticlePlainText": False,
    "withArticleSummaryText": False,
    "withArticleVoiceOver": False,
    "withGrokAnalyze": False,
    "withDisallowedReplyControls": False,
})

# Parsed dict forms for use in the POST body of authenticated timeline requests.
_SEARCH_FEATURES_DICT = json.loads(_SEARCH_FEATURES)
_SEARCH_FIELD_TOGGLES_DICT = json.loads(_SEARCH_FIELD_TOGGLES)


# ── data classes ──────────────────────────────────────────────────


@dataclass
class User:
    id: str
    name: str
    screen_name: str
    description: str
    created_at: str
    followers: int
    following: int
    tweets: int
    favorites: int
    banner_url: str | None = None
    avatar_url: str | None = None
    location: str | None = None
    url: str | None = None
    protected: bool = False
    verified: bool = False
    professional: dict | None = None


@dataclass
class VideoVariant:
    bitrate: int
    url: str


@dataclass
class Media:
    url: str
    type: str
    duration_ms: int | None = None
    hls: str | None = None
    mp4: list[VideoVariant] = field(default_factory=list)

    @property
    def best_mp4(self) -> VideoVariant | None:
        return self.mp4[0] if self.mp4 else None


@dataclass
class TweetUser:
    id: str
    screen_name: str
    name: str


@dataclass
class Tweet:
    id: str
    text: str
    created_at: str
    lang: str
    likes: int
    retweets: int
    replies: int
    quotes: int
    bookmarks: int
    in_reply_to: str | None = None
    hashtags: list[str] = field(default_factory=list)
    urls: list[dict] = field(default_factory=list)
    mentions: list[dict] = field(default_factory=list)
    media: list[Media] = field(default_factory=list)
    user: TweetUser | None = None
    quoted_tweets: list[Tweet] = field(default_factory=list)


@dataclass
class ThreadSummary:
    id: str
    screen_name: str
    user_id: str
    size: int
    url: str
    excerpt: str
    hashtags: list[str]
    content: list[str]  # HTML content per tweet


@dataclass
class ListedThread:
    id: str | None
    href: str
    screen_name: str | None
    display_name: str | None
    date: str | None
    text: str
    tweet_count: str | None


@dataclass
class SearchPage:
    query: str
    product: str
    tweets: list[Tweet]
    next_cursor: str | None = None


# ── client ───────────────────────────────────────────────────────


class XcomClient:
    """Standalone X.com GraphQL + ThreadReaderApp client."""

    def __init__(self, auth_token: str | None = None, ct0: str | None = None) -> None:
        self._s = requests.Session()
        self._s.headers.update({
            "authorization": _BEARER,
            "user-agent": _UA,
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en",
        })
        self._guest_token: str | None = None
        self._guest_expiry: float = 0
        self._auth_token = auth_token or os.environ.get("X_AUTH_TOKEN")
        self._ct0 = ct0 or os.environ.get("X_CT0")

    def _ensure_guest_token(self) -> str:
        if self._guest_token and time.time() < self._guest_expiry:
            return self._guest_token
        r = self._s.post(f"{_API}/1.1/guest/activate.json",
                         headers={"content-type": "application/json"}, timeout=10)
        r.raise_for_status()
        self._guest_token = r.json()["guest_token"]
        self._guest_expiry = time.time() + 7200  # 2 hours
        return self._guest_token

    def _graphql(self, name: str, variables: dict, *, tweet_features: bool = False) -> dict:
        self._ensure_guest_token()
        features = _TWEET_FEATURES if tweet_features else _FEATURES
        params = {
            "variables": json.dumps(variables),
            "features": features,
        }
        r = self._s.get(
            f"{_API}/graphql/{_Q[name]}/{name}",
            params=params,
            headers={"x-guest-token": self._guest_token},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["data"]

    def _authenticated_graphql(self, name: str, variables: dict) -> dict:
        if not self._auth_token or not self._ct0:
            raise RuntimeError(
                "X search requires an authenticated web session. Set both "
                "X_AUTH_TOKEN and X_CT0 from your own x.com session."
            )
        # SearchTimeline must be POSTed over curl_cffi with Chrome TLS
        # impersonation; plain requests gets an empty-body 404 from X's edge.
        try:
            from curl_cffi import requests as creq
        except ImportError as exc:  # pragma: no cover - exercised when dep missing
            raise RuntimeError(
                "curl_cffi is required for search: pip install curl_cffi"
            ) from exc

        at, ct = self._auth_token, self._ct0
        headers = {
            "authorization": _BEARER,
            "user-agent": _UA,
            "accept": "*/*",
            "cookie": f"auth_token={at}; ct0={ct}",
            "x-csrf-token": ct,
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en",
            "content-type": "application/json",
            "referer": f"https://x.com/search?q={quote(variables.get('rawQuery', ''))}"
                       + ("&f=live" if variables.get('product') == 'Latest' else ""),
        }
        body = {
            "variables": variables,
            "features": _SEARCH_FEATURES_DICT,
            "fieldToggles": _SEARCH_FIELD_TOGGLES_DICT,
        }
        try:
            r = creq.post(
                f"{_WEB_API}/graphql/{_Q[name]}/{name}",
                data=json.dumps(body),
                headers=headers,
                impersonate="chrome124",
                timeout=30,
            )
        except Exception as e:
            raise RuntimeError(f"X search request failed: {e}") from e
        if r.status_code == 429:
            reset = r.headers.get("x-rate-limit-reset")
            if reset:
                try:
                    wait_s = max(int(reset) - int(time.time()), 0)
                    wait_min = max(wait_s // 60, 1)
                    raise RuntimeError(
                        f"X search rate limit hit (429). Retry in {wait_min} minutes."
                    )
                except ValueError:
                    pass
            raise RuntimeError("X search rate limit hit (429). Wait ~15 minutes before retrying.")
        if r.status_code in (401, 403):
            raise RuntimeError("X search session is invalid or expired")
        r.raise_for_status()
        payload = r.json()
        if payload.get("errors"):
            raise RuntimeError(f"X SearchTimeline error: {payload['errors'][0]['message']}")
        return payload["data"]

    # ── X.com GraphQL API ──────────────────────────────────────

    def user(self, screen_name: str) -> User:
        """Look up a user by screen name."""
        data = self._graphql("UserByScreenName", {
            "screen_name": screen_name,
            "withGrokTranslatedBio": False,
        })
        raw = data["user"]["result"]
        core = raw.get("core") or {}
        legacy = raw.get("legacy") or {}
        return User(
            id=raw["rest_id"],
            name=core.get("name") or legacy.get("name", ""),
            screen_name=core.get("screen_name") or legacy.get("screen_name", ""),
            description=legacy.get("description", ""),
            created_at=legacy.get("created_at", ""),
            followers=legacy.get("followers_count", 0),
            following=legacy.get("friends_count", 0),
            tweets=legacy.get("statuses_count", 0),
            favorites=legacy.get("favourites_count", 0),
            banner_url=legacy.get("profile_banner_url"),
            avatar_url=legacy.get("profile_image_url_https"),
            location=legacy.get("location"),
            url=legacy.get("url"),
            protected=legacy.get("protected", False),
            verified=legacy.get("verified") or legacy.get("is_blue_verified", False),
            professional=raw.get("professional"),
        )

    def tweets(self, user_id: str) -> list[Tweet]:
        """Get a user's highlights/best tweets."""
        data = self._graphql("UserTweets", {
            "userId": user_id,
            "count": 20,
            "includePromotedContent": True,
            "withQuickPromoteEligibleTweetFields": False,
            "withSuperFollowsUserFields": True,
            "withDownvotePerspective": False,
            "withReactionsMetadata": False,
            "withReactionsPerspective": False,
            "withSuperFollowsTweetFields": False,
            "withVoice": False,
            "withV2Timeline": False,
        })
        instructions = (data.get("user", {}).get("result", {})
                        .get("timeline", {}).get("timeline", {})
                        .get("instructions", []))
        for inst in instructions:
            if inst.get("type") == "TimelineAddEntries":
                return [_parse_tweet(e["content"]["itemContent"]["tweet_results"]["result"])
                        for e in inst.get("entries", [])
                        if e.get("entryId", "").startswith("tweet-")]
        return []

    def tweet(self, tweet_id: str) -> Tweet:
        """Get tweet detail by ID (includes video/media URLs)."""
        data = self._graphql("TweetResultByRestId", {
            "tweetId": tweet_id,
            "withCommunity": False,
            "includePromotedContent": False,
            "withVoice": False,
        }, tweet_features=True)
        result = data.get("tweetResult", {}).get("result")
        if not result:
            raise ValueError(f"Tweet {tweet_id} not found or restricted")
        if result.get("__typename") == "TweetWithVisibilityResults":
            result = result.get("tweet", {})
        if not result or "rest_id" not in result:
            raise ValueError(f"Tweet {tweet_id} not found or restricted")
        return _parse_tweet(result)

    def video_url(self, tweet_id: str, quality: str = "best") -> str | None:
        """Get direct video URL for a tweet.

        quality: "best" (1080p), "720p", "360p", "270p", or "hls"
        """
        t = self.tweet(tweet_id)
        for m in t.media:
            if m.type != "video":
                continue
            if quality == "hls":
                return m.hls
            if quality == "best":
                v = m.best_mp4
                return v.url if v else None
            targets = {"1080p": 10368000, "720p": 2176000, "360p": 832000, "270p": 256000}
            target_br = targets.get(quality)
            if target_br and m.mp4:
                return min(m.mp4, key=lambda v: abs(v.bitrate - target_br)).url
        return None

    def search(
        self,
        query: str,
        *,
        count: int = 20,
        product: str = "Latest",
        cursor: str | None = None,
    ) -> SearchPage:
        """Search public X posts.

        product is "Latest" (chronological) or "Top" (ranked). Pass the
        returned next_cursor to fetch another page. Search requires your own
        authenticated x.com web session through X_AUTH_TOKEN and X_CT0.
        """
        query = query.strip()
        if not query:
            raise ValueError("Search query cannot be empty")
        if not 1 <= count <= 100:
            raise ValueError("Search count must be between 1 and 100")
        products = {"latest": "Latest", "top": "Top"}
        normalized_product = products.get(product.lower())
        if not normalized_product:
            raise ValueError('Search product must be "Latest" or "Top"')

        variables = {
            "rawQuery": query,
            "count": count,
            "querySource": "typed_query",
            "product": normalized_product,
            "withGrokTranslatedBio": normalized_product == "Top",
            "withQuickPromoteEligibilityTweetFields": False,
        }
        if cursor:
            variables["cursor"] = cursor

        data = self._authenticated_graphql("SearchTimeline", variables)
        timeline = (data.get("search_by_raw_query", {})
                    .get("search_timeline", {})
                    .get("timeline", {}))
        tweets, next_cursor = _parse_search_timeline(timeline)
        return SearchPage(
            query=query,
            product=normalized_product,
            tweets=tweets,
            next_cursor=next_cursor,
        )

    # ── ThreadReaderApp API ─────────────────────────────────────

    def _tra_get(self, path: str) -> dict:
        r = requests.get(f"{_TRA}{path}", headers={"user-agent": _UA}, timeout=15)
        r.raise_for_status()
        return r.json()

    def thread_summary(self, tweet_id: str) -> ThreadSummary | None:
        """Get full thread content from ThreadReaderApp JSON API (single call).

        Returns all tweet text + images as HTML content, thread metadata.
        No auth needed — uses /api/v0/thread/{id}.json.
        """
        d = self._tra_get(f"/api/v0/thread/{tweet_id}.json")
        if d.get("code") != 200:
            return None
        return ThreadSummary(
            id=d["id"],
            screen_name=d["screenName"],
            user_id=d["userId"],
            size=d["size"],
            url=d["url"],
            excerpt=d.get("excerpt", ""),
            hashtags=d.get("hashtags", []),
            content=d.get("content", []),
        )

    def thread_status(self, tweet_id: str) -> bool:
        """Check if a thread exists on ThreadReaderApp."""
        try:
            d = self._tra_get(f"/api/v0/ping/{tweet_id}.json")
            return d.get("code") == 200
        except requests.RequestException:
            return False

    def popular_threads(self, offset: int = 0) -> list[ListedThread]:
        """Get popular/recent well-liked threads from ThreadReaderApp.

        Paginated via offset (default page size ~17).
        """
        r = requests.get(f"{_TRA}/thread/popular", params={"offset": offset},
                         headers={"user-agent": _UA}, timeout=15)
        r.raise_for_status()
        return _parse_thread_list(r.text)

    def user_threads(self, screen_name: str, offset: int = 0) -> list[ListedThread]:
        """Get all threads by a user from ThreadReaderApp.

        Paginated via offset.
        """
        r = requests.get(f"{_TRA}/user/{screen_name}", params={"offset": offset},
                         headers={"user-agent": _UA}, timeout=15)
        r.raise_for_status()
        return _parse_thread_list(r.text)

    # ── Combined thread unrolling ────────────────────────────────

    def thread(self, tweet_id: str, *, enrich: bool = False, fetch_quotes: bool = True) -> list[Tweet]:
        """Un-roll a thread using ThreadReaderApp JSON API.

        If enrich=False (default): returns Tweet objects with text and media
        extracted from ThreadReaderApp's content HTML. Fast — single API call.
        No engagement metrics or timestamps.

        If fetch_quotes=True (default): for tweets that link to other tweets
        (quoted tweets, self-references), fetches those via X GraphQL to get
        their text and images. Adds ~0.25s per quoted tweet.

        If enrich=True: implies fetch_quotes=True. Also enriches each thread
        tweet via X GraphQL for timestamps, engagement, and video URLs.
        Slower — one GraphQL call per tweet.
        """
        summary = self.thread_summary(tweet_id)
        if not summary:
            return [self.tweet(tweet_id)]

        tweets: list[Tweet] = []
        quote_ids_to_fetch: set[str] = set()

        for html in summary.content:
            text = re.sub(r"<[^>]+>", " ", html).strip()
            text = re.sub(r"\s+", " ", text)
            imgs = re.findall(r'pbs\.twimg\.com/media/([^"\')\s]+)', html)
            media = [Media(url=f"https://pbs.twimg.com/media/{u}", type="photo") for u in imgs]

            # Collect quoted/referenced tweet IDs (exclude the thread's own tweets)
            ref_ids = list(dict.fromkeys(
                re.findall(r'https?://(?:twitter|x)\.com/\w+/status/(\d{15,})', html)
            ))

            t = Tweet(
                id=tweet_id,
                text=text,
                created_at="",
                lang="",
                likes=0,
                retweets=0,
                replies=0,
                quotes=0,
                bookmarks=0,
                media=media,
                user=TweetUser(id=summary.user_id, screen_name=summary.screen_name, name=""),
            )
            tweets.append(t)

            if ref_ids and (fetch_quotes or enrich):
                for rid in ref_ids:
                    quote_ids_to_fetch.add(rid)

        # Fetch quoted tweets via X GraphQL
        if quote_ids_to_fetch:
            seen = set(tid for tid in quote_ids_to_fetch)
            for rid in quote_ids_to_fetch:
                if rid in seen:
                    seen.discard(rid)
                    try:
                        qt = self.tweet(rid)
                        # Attach to every thread tweet that references this ID
                        for tt in tweets:
                            if rid in tt.text and rid not in {q.id for q in tt.quoted_tweets}:
                                tt.quoted_tweets.append(qt)
                    except (ValueError, requests.RequestException):
                        pass
                    time.sleep(0.25)

        if enrich:
            # Collect tweet IDs from ThreadReaderApp HTML page for enrichment
            r = requests.get(f"{_TRA}/thread/{tweet_id}.html",
                             headers={"user-agent": _UA}, timeout=15)
            r.raise_for_status()
            ids: list[str] = []
            seen: set[str] = set()
            for m in re.finditer(r'data-tweet="(\d+)"', r.text):
                tid = m.group(1)
                if tid not in seen:
                    seen.add(tid)
                    ids.append(tid)

            if ids:
                for i, tid in enumerate(ids):
                    try:
                        enriched = self.tweet(tid)
                        # Merge: keep TRA images as fallback, add X media
                        if enriched.media:
                            tweets[i].media = enriched.media
                        tweets[i].id = enriched.id
                        tweets[i].created_at = enriched.created_at
                        tweets[i].lang = enriched.lang
                        tweets[i].likes = enriched.likes
                        tweets[i].retweets = enriched.retweets
                        tweets[i].replies = enriched.replies
                        tweets[i].quotes = enriched.quotes
                        tweets[i].bookmarks = enriched.bookmarks
                        tweets[i].hashtags = enriched.hashtags
                        tweets[i].mentions = enriched.mentions
                        tweets[i].urls = enriched.urls
                        tweets[i].in_reply_to = enriched.in_reply_to
                        if enriched.user:
                            tweets[i].user = enriched.user
                    except (ValueError, requests.RequestException):
                        pass
                    if i < len(ids) - 1:
                        time.sleep(0.25)

        return tweets

    def _fetch_media_bytes(self, url: str) -> bytes | None:
        try:
            r = requests.get(url, timeout=10, headers={"user-agent": _UA})
            r.raise_for_status()
            return r.content
        except requests.RequestException:
            return None

    def thread_html(self, tweet_id: str, *, embed_media: bool = True) -> str:
        """Render a thread as a self-contained HTML document.

        If embed_media is True, images are inlined as base64 data URIs.
        Videos get an inline <video> tag (mp4) or a thumbnail with a link.
        """
        import base64 as _b64

        tweets = self.thread(tweet_id)
        if not tweets:
            return ""

        author = tweets[0].user
        author_name = author.screen_name if author else "?"
        author_display = author.name if author else ""

        parts: list[str] = []
        parts.append(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thread by @{author_name}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       background: #15202b; color: #e7e9ea; max-width: 680px; margin: 0 auto; padding: 16px; }}
.header {{ padding: 20px 0 16px; border-bottom: 1px solid #2f3336; margin-bottom: 20px; }}
.header h1 {{ font-size: 20px; font-weight: 700; }}
.header .meta {{ color: #71767b; font-size: 13px; margin-top: 4px; }}
.header a {{ color: #1d9bf0; text-decoration: none; }}
.tweet {{ padding: 16px 0; border-bottom: 1px solid #2f3336; }}
.tweet .num {{ color: #71767b; font-size: 12px; font-weight: 600; margin-bottom: 6px; }}
.tweet .author {{ color: #e7e9ea; font-size: 15px; font-weight: 700; }}
.tweet .author span {{ color: #71767b; font-weight: 400; }}
.tweet .date {{ color: #71767b; font-size: 13px; margin-bottom: 8px; }}
.tweet .text {{ font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }}
.tweet .text a {{ color: #1d9bf0; text-decoration: none; }}
.tweet .media {{ margin-top: 12px; border-radius: 16px; overflow: hidden; }}
.tweet .media img {{ max-width: 100%; display: block; border-radius: 16px; }}
.tweet .media video {{ max-width: 100%; display: block; border-radius: 16px; }}
.tweet .media .gallery {{ display: grid; gap: 2px; border-radius: 16px; overflow: hidden; }}
.tweet .media .gallery.g2 {{ grid-template-columns: 1fr 1fr; }}
.tweet .media .gallery.g3 {{ grid-template-columns: 1fr 1fr; }}
.tweet .media .gallery.g4 {{ grid-template-columns: 1fr 1fr; }}
.tweet .media .gallery img {{ width: 100%; display: block; }}
.tweet .stats {{ color: #71767b; font-size: 13px; margin-top: 10px; display: flex; gap: 16px; }}
.quote {{ margin: 12px 0 4px 16px; padding: 12px 16px; border-left: 3px solid #2f3336; border-radius: 0 12px 12px 0; background: #192734; }}
.quote .author {{ color: #e7e9ea; font-size: 14px; font-weight: 700; margin-bottom: 6px; }}
.quote .author span {{ color: #71767b; font-weight: 400; }}
.quote .text {{ font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }}
.quote .text a {{ color: #1d9bf0; text-decoration: none; }}
.quote .media {{ margin-top: 8px; border-radius: 12px; overflow: hidden; }}
.quote .media img {{ max-width: 100%; display: block; border-radius: 12px; }}
.quote .media video {{ max-width: 100%; display: block; border-radius: 12px; }}
.quote .media .gallery {{ display: grid; gap: 2px; border-radius: 12px; overflow: hidden; }}
.quote .media .gallery img {{ width: 100%; display: block; }}
.quote .link {{ color: #71767b; font-size: 12px; margin-top: 8px; }}
.footer {{ padding: 20px 0; text-align: center; color: #71767b; font-size: 12px; }}
</style>
</head>
<body>
<div class="header">
  <h1>@{_esc(author_name)}{_esc(f" ({author_display})") if author_display else ""}</h1>
  <div class="meta">{len(tweets)} tweets &mdash; <a href="https://x.com/{author_name}/status/{tweet_id}">View on X</a></div>
</div>
""")

        print(f"Fetching media for {len(tweets)} tweets...")
        for i, t in enumerate(tweets, 1):
            parts.append('<div class="tweet">')
            parts.append(f'<div class="num">{i}/{len(tweets)}</div>')
            if t.user:
                parts.append(f'<div class="author">{_esc(t.user.name)} <span>@{_esc(t.user.screen_name)}</span></div>')
            if t.created_at:
                parts.append(f'<div class="date">{_esc(t.created_at)}</div>')

            text_html = _esc(t.text)
            text_html = re.sub(r'@(\w+)', r'<a href="https://x.com/\1">@\1</a>', text_html)
            text_html = re.sub(r'(https?://\S+)', r'<a href="\1">\1</a>', text_html)
            parts.append(f'<div class="text">{text_html}</div>')

            photos = [m for m in t.media if m.type == "photo"]
            videos = [m for m in t.media if m.type in ("video", "animated_gif")]

            if photos:
                if len(photos) == 1:
                    img_url = photos[0].url + "?name=large"
                    if embed_media:
                        data = self._fetch_media_bytes(img_url)
                        if data:
                            b64 = _b64.b64encode(data).decode()
                            parts.append(f'<div class="media"><img src="data:image/jpeg;base64,{b64}" alt="image"></div>')
                            photos = []
                    if photos:
                        parts.append(f'<div class="media"><img src="{img_url}" alt="image" loading="lazy"></div>')
                else:
                    gclass = f"g{min(len(photos), 4)}"
                    parts.append(f'<div class="media"><div class="gallery {gclass}">')
                    for p in photos:
                        img_url = p.url + "?name=large"
                        if embed_media:
                            data = self._fetch_media_bytes(img_url)
                            if data:
                                b64 = _b64.b64encode(data).decode()
                                parts.append(f'<img src="data:image/jpeg;base64,{b64}" alt="image">')
                                continue
                        parts.append(f'<img src="{img_url}" alt="image" loading="lazy">')
                    parts.append('</div></div>')

            if videos:
                for v in videos:
                    if embed_media and v.mp4:
                        vid_url = v.mp4[0].url
                        parts.append(f'<div class="media"><video controls preload="metadata"><source src="{vid_url}" type="video/mp4"></video></div>')
                    elif v.hls:
                        parts.append(f'<div class="media"><video controls preload="metadata"><source src="{v.hls}" type="application/x-mpegURL"></video></div>')
                    else:
                        thumb = photos[0].url if photos else ""
                        if thumb:
                            parts.append(f'<div class="media"><img src="{thumb}?name=medium" alt="video thumbnail"></div>')

            if any([t.likes, t.retweets, t.replies, t.bookmarks]):
                parts.append('<div class="stats">')
                if t.likes:
                    parts.append(f'<span>{t.likes:,} likes</span>')
                if t.retweets:
                    parts.append(f'<span>{t.retweets:,} reposts</span>')
                if t.replies:
                    parts.append(f'<span>{t.replies:,} replies</span>')
                if t.bookmarks:
                    parts.append(f'<span>{t.bookmarks:,} bookmarks</span>')
                parts.append('</div>')

            # Render quoted tweets
            for qt in t.quoted_tweets:
                parts.append('<div class="quote">')
                if qt.user:
                    parts.append(f'<div class="author">{_esc(qt.user.name)} <span>@{_esc(qt.user.screen_name)}</span></div>')
                qt_text = _esc(qt.text)
                qt_text = re.sub(r'@(\w+)', r'<a href="https://x.com/\1">@\1</a>', qt_text)
                parts.append(f'<div class="text">{qt_text}</div>')
                for m in qt.media:
                    if m.type == "photo":
                        img_url = m.url + "?name=large"
                        if embed_media:
                            data = self._fetch_media_bytes(img_url)
                            if data:
                                b64 = _b64.b64encode(data).decode()
                                parts.append(f'<div class="media"><img src="data:image/jpeg;base64,{b64}" alt="image"></div>')
                                continue
                        parts.append(f'<div class="media"><img src="{img_url}" alt="image" loading="lazy"></div>')
                    elif m.type in ("video", "animated_gif") and m.best_mp4:
                        parts.append(f'<div class="media"><video controls preload="metadata"><source src="{m.best_mp4.url}" type="video/mp4"></video></div>')
                parts.append(f'<div class="link"><a href="https://x.com/i/status/{qt.id}">View on X</a></div>')
                parts.append('</div>')

            parts.append('</div>')

        parts.append(f'<div class="footer">Unrolled from <a href="https://x.com/{author_name}/status/{tweet_id}">x.com</a> via <a href="https://threadreaderapp.com/thread/{tweet_id}">ThreadReaderApp</a></div>')
        parts.append('</body>\n</html>')
        return "\n".join(parts)

    def thread_markdown(self, tweet_id: str) -> str:
        """Return a thread as a markdown document with linked media."""
        tweets = self.thread(tweet_id)
        if not tweets:
            return ""

        author = tweets[0].user
        lines = []
        if author:
            lines.append(f"# Thread by @{author.screen_name}")
            lines.append("")
            lines.append(f"**{len(tweets)} tweets** — [View on X](https://x.com/{author.screen_name}/status/{tweet_id})")
            lines.append("")
            lines.append("---")
            lines.append("")

        for i, t in enumerate(tweets, 1):
            lines.append(f"## {i}/{len(tweets)}")
            lines.append("")
            if t.created_at:
                lines.append(f"*{t.created_at}*")
            lines.append(t.text)
            if t.media:
                lines.append("")
                for m in t.media:
                    if m.type == "photo":
                        lines.append(f"![image]({m.url}?name=large)")
                    elif m.type == "video" and m.mp4:
                        lines.append(f"[video]({m.mp4[0].url})")
                    elif m.type == "video" and m.hls:
                        lines.append(f"[video (hls)]({m.hls})")
            for qt in t.quoted_tweets:
                lines.append("")
                who = f"@{qt.user.screen_name}" if qt.user else "?"
                lines.append(f"> **{who}:** {qt.text}")
                for m in qt.media:
                    if m.type == "photo":
                        lines.append(f"> ![{who}]({m.url}?name=large)")
                    elif m.type == "video" and m.mp4:
                        lines.append(f"> [video]({m.mp4[0].url})")
                lines.append(f"> [View on X](https://x.com/i/status/{qt.id})")
            lines.append("")

        return "\n".join(lines)


# ── internal helpers ─────────────────────────────────────────────


def _unwrap_tweet_result(raw: dict | None) -> dict | None:
    if not raw:
        return None
    if raw.get("__typename") == "TweetWithVisibilityResults":
        raw = raw.get("tweet")
    if not raw or "rest_id" not in raw:
        return None
    return raw


def _parse_search_timeline(timeline: dict) -> tuple[list[Tweet], str | None]:
    tweets: list[Tweet] = []
    seen: set[str] = set()
    next_cursor: str | None = None

    def visit(value: object) -> None:
        nonlocal next_cursor
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return

        if value.get("cursorType") == "Bottom" and isinstance(value.get("value"), str):
            next_cursor = value["value"]

        tweet_results = value.get("tweet_results")
        if isinstance(tweet_results, dict):
            raw = _unwrap_tweet_result(tweet_results.get("result"))
            if raw:
                tweet_id = raw["rest_id"]
                if tweet_id not in seen:
                    seen.add(tweet_id)
                    tweets.append(_parse_tweet(raw))
                return

        for child in value.values():
            visit(child)

    visit(timeline.get("instructions", []))
    return tweets, next_cursor


def _parse_tweet(raw: dict) -> Tweet:
    legacy = raw.get("legacy") or {}
    core = (raw.get("core") or {}).get("user_results") or {}
    user_result = core.get("result")
    u = user_result.get("core") if user_result else None

    media = []
    ext = legacy.get("extended_entities") or {}
    for m in ext.get("media", []):
        vi = m.get("video_info") or {}
        media.append(Media(
            url=m.get("media_url_https", ""),
            type=m.get("type", ""),
            duration_ms=vi.get("duration_millis"),
            hls=next((v["url"] for v in vi.get("variants", [])
                       if v.get("content_type") == "application/x-mpegURL"), None),
            mp4=sorted(
                [VideoVariant(bitrate=v["bitrate"], url=v["url"])
                 for v in vi.get("variants", [])
                 if v.get("content_type") == "video/mp4"],
                key=lambda v: v.bitrate, reverse=True,
            ),
        ))

    return Tweet(
        id=raw["rest_id"],
        text=legacy.get("full_text", ""),
        created_at=legacy.get("created_at", ""),
        lang=legacy.get("lang", ""),
        likes=legacy.get("favorite_count", 0),
        retweets=legacy.get("retweet_count", 0),
        replies=legacy.get("reply_count", 0),
        quotes=legacy.get("quote_count", 0),
        bookmarks=legacy.get("bookmark_count", 0),
        in_reply_to=legacy.get("in_reply_to_status_id_str"),
        hashtags=[h["text"] for h in (legacy.get("entities") or {}).get("hashtags", [])],
        urls=[{"url": u.get("url", ""), "expanded_url": u.get("expanded_url", ""),
               "display_url": u.get("display_url", "")}
              for u in (legacy.get("entities") or {}).get("urls", [])],
        mentions=[{"screenName": m["screen_name"], "name": m["name"]}
                  for m in (legacy.get("entities") or {}).get("user_mentions", [])],
        media=media,
        user=TweetUser(id=user_result["rest_id"],
                       screen_name=u.get("screen_name", ""),
                       name=u.get("name", "")) if user_result and u else None,
    )


def _parse_thread_list(html: str) -> list[ListedThread]:
    """Parse thread cards from ThreadReaderApp HTML listing pages."""
    results: list[ListedThread] = []
    starts: list[int] = []
    for m in re.finditer(r'<div class="col-12(?: col-md-6 col-lg-4)?" data-controller="link"', html):
        starts.append(m.start())

    for i in range(len(starts)):
        block = html[starts[i]:starts[i + 1] if i + 1 < len(starts) else starts[i] + 4000]

        href_m = re.search(r'data-link-href="([^"]+)"', block)
        if not href_m:
            continue
        href = href_m.group(1)
        tid_m = re.match(r"/thread/(\d+)", href)

        sn_m = re.search(r'<small class="twitter_screen_name"><a href="/user/([^"]+)">', block)
        dn_m = re.search(r'<h4 class="twitter_name"><a[^>]*>([^<]+)</a>', block)
        date_m = re.search(r'<span class="time" data-time="[^"]*">([^<]+)', block)
        count_m = re.search(r'Read (\d+) tweets', block) or re.search(r'(\d+) tweets', block)

        # Extract first text content
        tweet_m = re.search(
            r'<div class="(?:content-tweet|card-tweetsv2)"[^>]*>([\s\S]*?)(?:</div>|<span class="entity-embed">)',
            block,
        ) or re.search(
            r'card-tweetsv2"[^>]*>(?:[\s\S]*?</div>\s*)?([\s\S]*?)(?:<span class="entity-embed">|$)',
            block,
        )
        text = ""
        if tweet_m:
            text = re.sub(r"<[^>]+>", " ", tweet_m.group(1)).strip()[:300]

        results.append(ListedThread(
            id=tid_m.group(1) if tid_m else None,
            href=href,
            screen_name=sn_m.group(1) if sn_m else None,
            display_name=dn_m.group(1) if dn_m else None,
            date=date_m.group(1).strip() if date_m else None,
            text=text,
            tweet_count=count_m.group(1) if count_m else None,
        ))

    return results


def _is_interactive() -> bool:
    return sys.stdout.isatty() and sys.stderr.isatty()


def _use_color() -> bool:
    """Decide whether to emit ANSI color. Honors --no-color, NO_COLOR, and non-tty."""
    if "--no-color" in sys.argv:
        return False
    if os.environ.get("NO_COLOR"):
        return False
    return _is_interactive()


class _C:
    """ANSI styles; no-ops when color is off (set COLOR after _use_color())."""
    COLOR = _use_color()

    @staticmethod
    def _wrap(code: str) -> str:
        return f"\033[{code}m" if _C.COLOR else ""

    reset = property(lambda _: _C._wrap("0"))
    bold = property(lambda _: _C._wrap("1"))
    dim = property(lambda _: _C._wrap("2"))
    blue = property(lambda _: _C._wrap("34"))
    cyan = property(lambda _: _C._wrap("36"))
    gray = property(lambda _: _C._wrap("90"))
    red = property(lambda _: _C._wrap("31"))
    yellow = property(lambda _: _C._wrap("33"))
    green = property(lambda _: _C._wrap("32"))


def _term_width() -> int:
    try:
        return max(60, min(shutil.get_terminal_size((100, 24)).columns, 140))
    except Exception:
        return 100


def _expand_tco(text: str, urls: list[dict]) -> str:
    """Replace t.co shortlinks with their expanded URLs in tweet text."""
    for u in urls or []:
        short = u.get("url")
        expanded = u.get("expanded_url") or u.get("expandedUrl")
        if short and expanded:
            text = text.replace(short, expanded)
    return text


def _relative_time(created_at: str) -> str:
    """X 'created_at' (e.g. 'Mon Aug 04 12:00:00 +0000 2025') -> '3d', '2h', or 'Aug 4'."""
    if not created_at:
        return ""
    try:
        # Python 3.7+: %Z matches literal 'UTC'; for +0000 use %z
        dt = datetime.strptime(created_at, "%a %b %d %H:%M:%S %z %Y")
    except ValueError:
        return created_at
    delta = datetime.now(timezone.utc) - dt
    secs = int(delta.total_seconds())
    if secs < 60:
        return f"{max(secs, 0)}s"
    if secs < 3600:
        return f"{secs // 60}m"
    if secs < 86400:
        return f"{secs // 3600}h"
    if secs < 86400 * 7:
        return f"{secs // 86400}d"
    return dt.strftime("%b %-d") if sys.platform != "win32" else dt.strftime("%b %#d")


def _format_count(n: int) -> str:
    """1, 12, 123, 1.2K, 3.4M, 1.1B — compact human counts."""
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n / 1000:.1f}K".replace(".0K", "K")
    if n < 1_000_000_000:
        return f"{n / 1_000_000:.1f}M".replace(".0M", "M")
    return f"{n / 1_000_000_000:.1f}B".replace(".0B", "B")


def _build_query_command(query: str, product: str, cursor: str | None) -> str:
    """Reconstruct the CLI command a user can paste to fetch the next page."""
    parts = [sys.executable, "xcom.py", "--search", _quote_arg(query), product.lower()]
    if cursor:
        parts += ["--cursor", cursor]
    return " ".join(parts)


def _quote_arg(s: str) -> str:
    """Quote a CLI arg for safe copy-paste into a POSIX shell."""
    if s and re.fullmatch(r"[A-Za-z0-9_@:/.,\-]+", s):
        return s
    return "'" + s.replace("'", "'\\''") + "'"


def render_search_page(page, *, show_cursor_cmd: bool = True, index_from: int = 1) -> None:
    """Pretty-print a SearchPage to the terminal as colored tweet cards."""
    c = _C()
    width = _term_width()
    inner = max(width - 4, 40)  # leave 2-char padding each side inside the border

    # ── Header ──────────────────────────────────────────────
    title = f"  {c.bold}{len(page.tweets)} {page.product} results{c.reset} for {c.cyan}\"{page.query}\"{c.reset}"
    print(title)
    print(c.gray + "─" * width + c.reset)

    if not page.tweets:
        print(f"\n  {c.dim}No results.{c.reset}\n")
        return

    # ── Tweet cards ─────────────────────────────────────────
    for i, t in enumerate(page.tweets, index_from):
        handle = t.user.screen_name if t.user else "?"
        name = t.user.name if t.user else ""
        rtime = _relative_time(t.created_at)
        text = _expand_tco(t.text, t.urls)

        # Author line: Name (bold) @handle (dim) · time (dim)
        author = f"  {c.bold}{name}{c.reset} {c.gray}@{handle}{c.reset}"
        if rtime:
            author += f" {c.gray}· {rtime}{c.reset}"
        print(author)

        # Body: wrapped, indented, preserved newlines
        for line in text.splitlines() or [text]:
            wrapped = textwrap.wrap(line, width=inner) or [""]
            for w in wrapped:
                print(f"  {w}")
        if not text.strip():
            print(f"  {c.dim}(no text){c.reset}")

        # Engagement row (compact)
        stats = []
        if t.replies:
            stats.append(f"{c.gray}💬 {_format_count(t.replies)}{c.reset}")
        if t.retweets:
            stats.append(f"{c.gray}🔁 {_format_count(t.retweets)}{c.reset}")
        if t.quotes:
            stats.append(f"{c.gray}quote {_format_count(t.quotes)}{c.reset}")
        if t.likes:
            stats.append(f"{c.red}♥ {_format_count(t.likes)}{c.reset}")
        if t.bookmarks:
            stats.append(f"{c.gray}🔖 {_format_count(t.bookmarks)}{c.reset}")
        media = [m for m in t.media if m.type in ("photo", "video", "animated_gif")]
        if media:
            kinds = "/".join(sorted({m.type for m in media}))
            stats.append(f"{c.blue}📎 {len(media)} {kinds}{c.reset}")
        if stats:
            print("  " + "   ".join(stats))

        # Link line
        print(f"  {c.blue}↗ https://x.com/{handle}/status/{t.id}{c.reset}")
        print(c.gray + "·" * width + c.reset)

    # ── Footer ──────────────────────────────────────────────
    if page.next_cursor:
        print()
        if show_cursor_cmd:
            cmd = _build_query_command(page.query, page.product, page.next_cursor)
            print(f"  {c.green}Next page:{c.reset}")
            print(f"  {c.dim}{cmd}{c.reset}")
        print(f"  {c.gray}(cursor: {page.next_cursor[:50]}…){c.reset}")
    else:
        print(f"\n  {c.gray}— end of results —{c.reset}")


if __name__ == "__main__":
    x = XcomClient()

    # Strip global flags we handle ourselves so the positional dispatcher below
    # still works unchanged. --no-color is consumed by _use_color() at import.
    CLI_ARGS = [a for a in sys.argv[1:] if a not in ("--no-color",)]
    if CLI_ARGS and CLI_ARGS[0] in ("-s", "--search"):
        # Flag form: python xcom.py --search "<q>" [latest|top] [--count N] [--cursor CUR]
        query = CLI_ARGS[1] if len(CLI_ARGS) > 1 else ""
        product = "latest"
        count = 20
        cursor = None
        rest = CLI_ARGS[2:]
        # positional product may come right after the query
        if rest and rest[0].lower() in ("latest", "top"):
            product = rest.pop(0).lower()
        it = iter(rest)
        for tok in it:
            if tok in ("--count", "-n") :
                try:
                    count = int(next(it))
                except (StopIteration, ValueError):
                    raise SystemExit("--count needs an integer")
            elif tok in ("--cursor",):
                cursor = next(it, None)
            elif tok in ("--top",):
                product = "top"
            elif tok in ("--latest",):
                product = "latest"
        if not query:
            raise SystemExit('Usage: python xcom.py --search "<query>" [latest|top] [--count N]')
        try:
            page = x.search(query, count=count, product=product, cursor=cursor)
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            raise SystemExit(1)
        render_search_page(page)
        raise SystemExit(0)

    if len(sys.argv) > 1:
        arg = sys.argv[1]
        mode = sys.argv[2] if len(sys.argv) > 2 else ""

        if arg == "search":
            if not mode:
                raise SystemExit('Usage: python xcom.py search "<query>" [latest|top]')
            product = sys.argv[3] if len(sys.argv) > 3 else "latest"
            try:
                page = x.search(mode, product=product)
            except RuntimeError as e:
                print(str(e), file=sys.stderr)
                raise SystemExit(1)
            render_search_page(page)
        elif arg.startswith("https://x.com/") or arg.startswith("https://twitter.com/"):
            parts = arg.rstrip("/").split("/")
            idx = parts.index("status") if "status" in parts else -1
            if idx >= 0 and idx + 1 < len(parts):
                tid = parts[idx + 1]
                if mode == "thread":
                    thread = x.thread(tid)
                    print(f"Thread by @{thread[0].user.screen_name} ({len(thread)} tweets)\n")
                    for i, t in enumerate(thread, 1):
                        print(f"--- Tweet {i}/{len(thread)} ---")
                        print(f"@{t.user.screen_name}  {t.created_at}")
                        print(f"{t.text}\n")
                        if t.media:
                            for m in t.media:
                                print(f"  [{m.type}] {m.url}")
                        for qt in t.quoted_tweets:
                            who = f"@{qt.user.screen_name}" if qt.user else "?"
                            print(f"  📎 Quoted {who}: {qt.text[:100]}{'...' if len(qt.text) > 100 else ''}")
                            for m in qt.media:
                                print(f"    [{m.type}] {m.url}")
                        if t.likes or t.retweets or t.replies:
                            print(f"  ♥ {t.likes:,}  🔁 {t.retweets:,}  💬 {t.replies:,}")
                        print()
                elif mode == "thread-enriched":
                    thread = x.thread(tid, enrich=True)
                    print(f"Thread by @{thread[0].user.screen_name} ({len(thread)} tweets, enriched)\n")
                    for i, t in enumerate(thread, 1):
                        print(f"--- Tweet {i}/{len(thread)} ---")
                        print(f"@{t.user.screen_name}  {t.created_at}")
                        print(f"{t.text}\n")
                        if t.media:
                            for m in t.media:
                                print(f"  [{m.type}] {m.url}")
                        for qt in t.quoted_tweets:
                            who = f"@{qt.user.screen_name}" if qt.user else "?"
                            print(f"  📎 Quoted {who}: {qt.text[:100]}{'...' if len(qt.text) > 100 else ''}")
                            for m in qt.media:
                                print(f"    [{m.type}] {m.url}")
                        if t.likes or t.retweets or t.replies:
                            print(f"  ♥ {t.likes:,}  🔁 {t.retweets:,}  💬 {t.replies:,}")
                        print()
                elif mode == "html":
                    html = x.thread_html(tid)
                    out_file = f"thread_{tid}.html"
                    with open(out_file, "w") as f:
                        f.write(html)
                    print(f"Saved {len(html):,} bytes to {out_file}")
                elif mode == "md":
                    md = x.thread_markdown(tid)
                    out_file = f"thread_{tid}.md"
                    with open(out_file, "w") as f:
                        f.write(md)
                    print(f"Saved {len(md):,} chars to {out_file}")
                elif mode == "summary":
                    s = x.thread_summary(tid)
                    if s:
                        print(f"Thread by @{s.screen_name} — {s.size} tweets")
                        print(f"Excerpt: {s.excerpt[:200]}")
                        print(f"URL: {s.url}")
                        print(f"Images in first tweet: {len(re.findall(r'pbs.twimg.com/media/', s.content[0]))}")
                    else:
                        print("Thread not found")
                else:
                    t = x.tweet(tid)
                    print(f"@{t.user.screen_name}: {t.text}")
                    print(f"Likes: {t.likes:,}  RT: {t.retweets:,}  Replies: {t.replies:,}")
                    if t.media:
                        for m in t.media:
                            if m.type == "video":
                                print(f"Video: {m.best_mp4.url[:80]}..." if m.best_mp4 else "Video: no mp4")
        elif mode == "threads":
            threads = x.user_threads(arg.lstrip("@"))
            print(f"{len(threads)} threads for @{arg.lstrip('@')}\n")
            for t in threads[:20]:
                count = f" ({t.tweet_count} tweets)" if t.tweet_count else ""
                name = f"@{t.screen_name}" if t.screen_name else ""
                print(f"  {t.id or '?'} {name}{count} — {t.text[:80]}")
        elif arg == "popular":
            threads = x.popular_threads()
            print(f"{len(threads)} popular threads\n")
            for t in threads[:20]:
                count = f" ({t.tweet_count} tweets)" if t.tweet_count else ""
                name = f"@{t.screen_name}" if t.screen_name else ""
                print(f"  {t.id or '?'} {name}{count} — {t.text[:80]}")
        else:
            u = x.user(arg.lstrip("@"))
            print(f"{u.name} (@{u.screen_name})")
            print(f"{u.followers:,} followers | {u.tweets:,} tweets")
    else:
        print('Usage: python xcom.py <screen_name | tweet_url | search "query" [latest|top] | --search "query" [latest|top]> [thread|thread-enriched|html|md|summary]')
        print()
        print('  python xcom.py --search "openai lang:en" top        # Search (pretty terminal cards)')
        print('  python xcom.py search "openai lang:en" latest       # Search (same, positional form)')
        print('          flags: --count N   --cursor CUR   --top   --latest   --no-color')
        print("  python xcom.py elonmusk                           # User lookup")
        print("  python xcom.py @user/threads                       # List user's threads")
        print("  python xcom.py https://x.com/user/status/12345    # Single tweet")
        print("  python xcom.py .../status/12345 thread             # Unroll thread (fast, from TRA)")
        print("  python xcom.py .../status/12345 thread-enriched    # Unroll + X metrics/video (slow)")
        print("  python xcom.py .../status/12345 html                # Self-contained HTML with embedded media")
        print("  python xcom.py .../status/12345 md                  # Markdown with linked images")
        print("  python xcom.py .../status/12345 summary            # Thread metadata from TRA")
        print()
        print("  python xcom.py popular                            # Show popular threads from TRA")
