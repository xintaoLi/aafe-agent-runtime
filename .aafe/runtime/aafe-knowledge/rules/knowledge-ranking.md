# Knowledge Ranking

Rank by log(1 + hit_count) × exp(-days_since_last_hit / half_life), not raw hit_count. Old high-hit items must not crowd out recent useful ones. Ranking is not lifecycle status.
