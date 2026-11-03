import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

/** Temps proposés dans le menu : une préférence, pas une durée de session. */
export const HOME_TEMPS = [30, 45, 60, 120] as const;

/**
 * Paramètres de `GET /api/home/menu`. Tous optionnels.
 *
 * Le `ValidationPipe` global est `whitelist` + `forbidNonWhitelisted` : tout
 * paramètre non déclaré ici répond 400.
 */
export class HomeMenuQueryDto {
  /** `appId` du jeu de référence ; absent = jeu du moment. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  anchor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(HOME_TEMPS)
  temps: 30 | 45 | 60 | 120 = 45;

  @IsOptional()
  @IsIn(['continuer', 'decouvrir', 'finir'])
  intention: 'continuer' | 'decouvrir' | 'finir' = 'continuer';

  /** `true` = manette complète ou partielle. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  manette: boolean = false;
}
