import { Entity, Column, Sync, DataType } from '../../../src/core/entity';

@Entity('products')
@Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })
export class Product {
  @Column({ type: DataType.Int32, isKey: true })
  seq!: number;

  @Column({ type: DataType.Float32 })
  price!: number;

  @Column({ type: DataType.Int32 })
  qty!: number;

  @Column({ type: DataType.Bool })
  inStock!: boolean;

  @Column({ type: DataType.String })
  name!: string;

  [field: string]: number | boolean | string;
}
