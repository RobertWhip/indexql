import { Entity, Column, Facet, DataType } from '../../../src/core/entity';

@Entity('products')
export class Product {
  @Column({ type: DataType.Int32 })
  seq!: number;

  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  price!: number;

  @Column({ type: DataType.Float32 })
  @Facet('RANGE')
  rating!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.Int8 })
  brandIdx!: number;

  [field: string]: number | boolean | string | object;
}