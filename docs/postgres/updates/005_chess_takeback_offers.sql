ALTER TABLE chess_games
    ADD COLUMN pending_takeback_by_player_id uuid,
    ADD COLUMN pending_takeback_requested_at timestamptz,
    ADD CONSTRAINT chess_games_pending_takeback_nullity_check
        CHECK (
            (pending_takeback_by_player_id IS NULL)
            = (pending_takeback_requested_at IS NULL)
        ),
    ADD CONSTRAINT chess_games_pending_takeback_player_fk
        FOREIGN KEY (id, pending_takeback_by_player_id)
        REFERENCES chess_game_players(game_id, id);
