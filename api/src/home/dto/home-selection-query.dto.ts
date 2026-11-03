import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Paramètres de `GET /api/home/selection`. Tous optionnels.
 *
 * `genre=0` signifie « aucun genre » : ne pas le refuser avec un `@Min(1)`.
 * Le `ValidationPipe` global est `whitelist` + `forbidNonWhitelisted` : tout
 * paramètre non déclaré ici répond 400.
 */
export class HomeSelectionQueryDto {
  /** `appId` du jeu de référence ; absent = jeu du moment. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  anchor?: number;

  /** Genre à privilégier ; absent = genre principal de l'ancre, 0 = aucun. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  genre?: number;

  /** Préférence de découverte, de 10 à 100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  decouverte: number = 30;

  /** `true` = manette complète ou partielle. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  manette: boolean = false;

  @IsOptional()
  @IsIn(['tous', 'deja', 'jamais'])
  lancement: 'tous' | 'deja' | 'jamais' = 'tous';

  /** `true` = jeux proches du 100 % de succès (ratio ≥ 75 %). */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  progression: boolean = false;
}
