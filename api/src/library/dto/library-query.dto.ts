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
import { FiltersQueryDto } from '../../catalog/dto/filters-query.dto.js';

export const LIBRARY_TRIS = ['nom', 'temps', 'recent'] as const;
export type TriBibliotheque = (typeof LIBRARY_TRIS)[number];

export const LIBRARY_DEFAULT_LIMIT = 48;
export const LIBRARY_MAX_LIMIT = 100;

/** Paramètres de `GET /api/library`. */
export class LibraryQueryDto extends FiltersQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 100)
  q?: string;

  @IsOptional()
  @IsIn(LIBRARY_TRIS)
  tri: TriBibliotheque = 'nom';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIBRARY_MAX_LIMIT)
  limit: number = LIBRARY_DEFAULT_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
