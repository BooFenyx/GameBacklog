import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { FiltersQueryDto } from '../../catalog/dto/filters-query.dto.js';

/** Modes de recherche exposés par l'API. */
export const SEARCH_MODES = ['name', 'semantic'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SEARCH_MAX_QUERY_LENGTH = 300;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/**
 * Paramètres de `GET /api/search`.
 *
 * `q` est trimé avant validation : une requête composée uniquement d'espaces
 * est donc refusée par `@Length(1, …)`. Les filtres (genres, modes, manette,
 * état, durée) sont hérités de `FiltersQueryDto` et appliqués dans les deux
 * modes de recherche.
 */
export class SearchQueryDto extends FiltersQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, SEARCH_MAX_QUERY_LENGTH)
  q!: string;

  @IsIn(SEARCH_MODES)
  mode!: SearchMode;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit: number = SEARCH_DEFAULT_LIMIT;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
