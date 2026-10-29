import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { DUREE_VALUES, type DureeJeu } from '../duree.js';
import { MODE_VALUES, type ModeJeu } from '../modes.js';

/** Découpe une valeur de requête en tableau de chaînes. */
function csvToStrings(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const valeurs = Array.isArray(value) ? value : [value];
  return valeurs
    .flatMap((entree) => String(entree).split(','))
    .map((entree) => entree.trim())
    .filter((entree) => entree.length > 0);
}

/** Découpe une valeur de requête en tableau d'entiers. */
function csvToNumbers(value: unknown): unknown {
  const valeurs = csvToStrings(value);
  return Array.isArray(valeurs)
    ? valeurs.map((entree) => Number(entree))
    : valeurs;
}

/**
 * Filtres communs à la bibliothèque et à la recherche.
 *
 * Les listes arrivent en CSV (`genres=25,23`), avec support des paramètres
 * répétés (`genres=25&genres=23`). Un id ou un mode inconnu est refusé par la
 * validation (400) : le client doit envoyer les valeurs exposées par les
 * facettes.
 */
export class FiltersQueryDto {
  @IsOptional()
  @Transform(({ value }) => csvToNumbers(value))
  @IsArray()
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(1, { each: true })
  genres?: number[];

  @IsOptional()
  @Transform(({ value }) => csvToStrings(value))
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(MODE_VALUES, { each: true })
  modes?: ModeJeu[];

  @IsOptional()
  @IsIn(['full'])
  manette?: 'full';

  @IsOptional()
  @IsIn(['jamais', 'joue'])
  etat?: 'jamais' | 'joue';

  @IsOptional()
  @Transform(({ value }) => csvToStrings(value))
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(DUREE_VALUES, { each: true })
  duree?: DureeJeu[];
}
