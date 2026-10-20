import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

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
 * est donc refusée par `@Length(1, …)`.
 */
export class SearchQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, SEARCH_MAX_QUERY_LENGTH)
  q!: string;

  @IsIn(SEARCH_MODES)
  mode!: SearchMode;

  @IsOptional()
  @IsIn(['full', 'partial'])
  manette?: 'full' | 'partial';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit: number = SEARCH_DEFAULT_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
