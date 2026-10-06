"""Swami Vivekananda: quotes and facts Sheru shares between nudges.

Quotes are kept close to The Complete Works of Swami Vivekananda (Advaita Ashrama);
popular internet misattributions are deliberately left out. Facts are short and
well documented (dates, places, people).
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal, Optional

Kind = Literal["quote", "fact"]


@dataclass(frozen=True)
class Wisdom:
    id: str
    kind: Kind
    text: str
    source: str
    tags: tuple[str, ...] = ()


QUOTES: tuple[Wisdom, ...] = (
    Wisdom("q-arise", "quote", "Arise, awake, and stop not till the goal is reached.",
           "Complete Works, Vol. 1 (after the Katha Upanishad)", ("goal", "start")),
    Wisdom("q-one-idea", "quote",
           "Take up one idea. Make that one idea your life — think of it, dream of it, live on that idea.",
           "Complete Works, Vol. 1, Raja-Yoga", ("focus",)),
    Wisdom("q-nibbling", "quote",
           "Those who really want to be Yogis must give up, once for all, this nibbling at things.",
           "Complete Works, Vol. 1, Raja-Yoga", ("focus", "distraction")),
    Wisdom("q-lions", "quote",
           "Come up, O lions, and shake off the delusion that you are sheep.",
           "Complete Works, Vol. 1, Chicago address (1893)", ("courage", "distraction")),
    Wisdom("q-education", "quote",
           "To me the very essence of education is concentration of mind, not the collecting of facts.",
           "Complete Works, Vol. 6, Concentration", ("focus", "study")),
    Wisdom("q-key", "quote",
           "The power of concentration is the only key to the treasure-house of knowledge.",
           "Complete Works, Vol. 2", ("focus", "study")),
    Wisdom("q-powers", "quote",
           "All the powers in the universe are already ours. It is we who have put our hands before our eyes "
           "and cry that it is dark.",
           "Complete Works, Vol. 2, Practical Vedanta", ("courage", "stuck")),
    Wisdom("q-destiny", "quote",
           "Stand up, be bold, be strong. Take the whole responsibility on your own shoulders, "
           "and know that you are the creator of your own destiny.",
           "Complete Works, Vol. 2", ("courage", "start")),
    Wisdom("q-thoughts", "quote",
           "We are what our thoughts have made us; so take care about what you think.",
           "Complete Works, Vol. 7, Inspired Talks", ("mind",)),
    Wisdom("q-gymnasium", "quote",
           "This world is the great gymnasium where we come to make ourselves strong.",
           "Complete Works, Vol. 1, Karma-Yoga", ("courage", "stuck")),
    Wisdom("q-silence", "quote",
           "The ideal man is he who, in the midst of the greatest silence and solitude, finds the intensest "
           "activity, and in the midst of the intensest activity finds the silence and solitude of the desert.",
           "Complete Works, Vol. 1, Karma-Yoga", ("focus", "calm")),
    Wisdom("q-strong", "quote",
           "If you think yourselves strong, strong you will be.",
           "Complete Works, Vol. 3, Lectures from Colombo to Almora", ("courage", "stuck")),
    Wisdom("q-faith", "quote",
           "Have faith in yourselves, and stand up on that faith and be strong; that is what we need.",
           "Complete Works, Vol. 3", ("courage",)),
    Wisdom("q-strength-life", "quote", "Strength is life, weakness is death.",
           "Complete Works, Vol. 2", ("courage",)),
    Wisdom("q-high-thoughts", "quote",
           "Fill the brain with high thoughts, highest ideals, place them day and night before you, "
           "and out of that will come great work.",
           "Complete Works, Vol. 2, Practical Vedanta", ("goal", "mind")),
    Wisdom("q-impossible", "quote",
           "Never think there is anything impossible for the soul.",
           "Complete Works, Vol. 7", ("courage", "stuck")),
    Wisdom("q-seek", "quote", "Neither seek nor avoid; take what comes.",
           "Complete Works, Vol. 7, Inspired Talks", ("calm",)),
    Wisdom("q-learn", "quote",
           "Learn everything that is good from others, but bring it in, and in your own way absorb it; "
           "do not become others.",
           "Complete Works, Vol. 3", ("study",)),
    Wisdom("q-steady", "quote",
           "Calm and silent and steady work, and no newspaper humbug, no name-making.",
           "Complete Works, Vol. 5, Epistles", ("focus", "calm")),
    Wisdom("q-believe", "quote",
           "You cannot believe in God until you believe in yourself.",
           "Complete Works, Vol. 2, Practical Vedanta", ("courage",)),
    Wisdom("q-good", "quote",
           "This is the gist of all worship — to be pure and to do good to others.",
           "Complete Works, Vol. 3, Address at Rameswaram", ("kindness",)),
    Wisdom("q-help", "quote",
           "Condemn none: if you can stretch out a helping hand, do so. If you cannot, fold your hands, "
           "bless your brothers, and let them go their own way.",
           "Complete Works, Vol. 2", ("kindness",)),
    Wisdom("q-divine", "quote",
           "Each soul is potentially divine. The goal is to manifest this Divinity within.",
           "Complete Works, Vol. 1, Raja-Yoga, Preface", ("goal",)),
    Wisdom("q-wait", "quote",
           "Do not wait for anybody or anything. Do whatever you can, build your hope on none.",
           "Complete Works, Vol. 5, Epistles", ("start", "stuck")),
)

FACTS: tuple[Wisdom, ...] = (
    Wisdom("f-born", "fact",
           "Swami Vivekananda was born Narendranath Datta on 12 January 1863 in Calcutta. "
           "India celebrates that day as National Youth Day.", "Biography"),
    Wisdom("f-chicago", "fact",
           "On 11 September 1893 he opened his Chicago speech with 'Sisters and Brothers of America' "
           "and the hall gave him a standing ovation.", "World's Parliament of Religions, 1893"),
    Wisdom("f-mission", "fact",
           "He founded the Ramakrishna Mission on 1 May 1897 — built on service: "
           "'Atmano mokshartham jagad hitaya cha' (for one's own liberation and the good of the world).",
           "Ramakrishna Mission"),
    Wisdom("f-rock", "fact",
           "In December 1892 he swam out to a rock off Kanyakumari and meditated there for three days. "
           "Today it is the Vivekananda Rock Memorial.", "Kanyakumari, 1892"),
    Wisdom("f-tata", "fact",
           "On a ship from Yokohama to Vancouver in 1893 he met Jamsetji Tata. Tata later wrote to him "
           "about a research institute — the seed of the Indian Institute of Science.",
           "Tata's letter of 23 November 1898"),
    Wisdom("f-tesla", "fact",
           "In 1896 he met Nikola Tesla in New York. He wrote that Tesla was charmed by the Vedantic ideas "
           "of Prana and Akasha.", "Letter of 13 February 1896"),
    Wisdom("f-ramakrishna", "fact",
           "As a young student he asked Sri Ramakrishna, 'Sir, have you seen God?' The answer — "
           "'Yes, I see Him as I see you' — changed his life.", "Dakshineswar, 1881"),
    Wisdom("f-wanderer", "fact",
           "From 1888 to 1893 he walked across India as a wandering monk, from the Himalayas to Kanyakumari, "
           "often with just a staff and a water pot.", "Parivrajaka years"),
    Wisdom("f-books", "fact",
           "His books Raja-Yoga, Karma-Yoga, Bhakti-Yoga and Jnana-Yoga grew out of lectures he gave in "
           "America and England in the 1890s.", "Complete Works"),
    Wisdom("f-nivedita", "fact",
           "Margaret Noble met him in London in 1895, came to India and became Sister Nivedita, "
           "a pioneer of girls' education in Calcutta.", "Sister Nivedita"),
    Wisdom("f-belur", "fact",
           "He established Belur Math on the banks of the Ganga near Calcutta. It is still the headquarters "
           "of the Ramakrishna Order.", "Belur Math, 1898"),
    Wisdom("f-memory", "fact",
           "Friends were astonished by his memory: he could read a book quickly and recall whole passages "
           "of it word for word.", "Reminiscences of his disciples"),
    Wisdom("f-music", "fact",
           "He was a trained classical singer and played the pakhawaj and tabla. Sri Ramakrishna first "
           "noticed him because of his singing.", "Biography"),
    Wisdom("f-name", "fact",
           "The name 'Vivekananda' joins viveka (discernment) and ananda (bliss): the bliss of "
           "discriminating wisdom.", "Sanskrit"),
    Wisdom("f-sheep", "fact",
           "He loved telling the story of a lion cub raised among sheep that bleated and ate grass — "
           "until another lion showed it its reflection. That's where I, Sheru, come from!",
           "Parable from his lectures"),
    Wisdom("f-age", "fact",
           "He passed away on 4 July 1902 at Belur Math, only 39 years old — and changed how the world "
           "saw India in under a decade of public life.", "Biography"),
)

# Quotes that suit a given moment (used by the coach when it wants a fitting line).
MOMENT_TAGS: dict[str, tuple[str, ...]] = {
    "distraction": ("distraction", "focus"),
    "stuck": ("stuck", "courage"),
    "start": ("start", "goal"),
    "focus": ("focus", "calm"),
    "study": ("study", "focus"),
}

ALL: tuple[Wisdom, ...] = QUOTES + FACTS


def by_id(wisdom_id: str) -> Optional[Wisdom]:
    return next((w for w in ALL if w.id == wisdom_id), None)


class WisdomPicker:
    """Random picks that avoid repeating anything recently shown."""

    def __init__(self, rng: Optional[random.Random] = None, memory: int = 12) -> None:
        self._rng = rng or random.Random()
        self._recent: list[str] = []
        self._memory = memory

    def _choose(self, pool: tuple[Wisdom, ...] | list[Wisdom]) -> Wisdom:
        fresh = [w for w in pool if w.id not in self._recent] or list(pool)
        pick = self._rng.choice(fresh)
        self._recent.append(pick.id)
        del self._recent[: -self._memory]
        return pick

    def quote(self, moment: Optional[str] = None) -> Wisdom:
        tags = MOMENT_TAGS.get(moment or "", ())
        pool = [q for q in QUOTES if set(q.tags) & set(tags)] if tags else list(QUOTES)
        return self._choose(pool or list(QUOTES))

    def fact(self) -> Wisdom:
        return self._choose(FACTS)

    def any(self, quote_ratio: float = 0.65) -> Wisdom:
        return self.quote() if self._rng.random() < quote_ratio else self.fact()
