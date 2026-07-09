import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";

export class SpotSymbol extends Model {
  declare id: number;
  declare symbol: string;
  declare base: string;
  declare quote: string;
  declare displayName: string;
  declare pricePrecision: number;
  declare qtyPrecision: number;
  declare minQty: string;
  declare makerFee: string;
  declare takerFee: string;
  declare sortOrder: number;
  declare status: number;
  declare createTime: Date;
  declare updateTime: Date;
}

export async function initSpotSymbolModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  SpotSymbol.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: "f_id" },
      symbol: { type: DataTypes.STRING(32), field: "f_symbol", allowNull: false, unique: true },
      base: { type: DataTypes.STRING(16), field: "f_base", allowNull: false },
      quote: { type: DataTypes.STRING(16), field: "f_quote", allowNull: false },
      displayName: {
        type: DataTypes.STRING(64),
        field: "f_display_name",
        allowNull: false,
        defaultValue: "",
      },
      pricePrecision: {
        type: DataTypes.TINYINT,
        field: "f_price_precision",
        allowNull: false,
        defaultValue: 2,
      },
      qtyPrecision: {
        type: DataTypes.TINYINT,
        field: "f_qty_precision",
        allowNull: false,
        defaultValue: 6,
      },
      minQty: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_min_qty",
        allowNull: false,
        defaultValue: 0,
      },
      makerFee: {
        type: DataTypes.DECIMAL(10, 6),
        field: "f_maker_fee",
        allowNull: false,
        defaultValue: 0.001,
      },
      takerFee: {
        type: DataTypes.DECIMAL(10, 6),
        field: "f_taker_fee",
        allowNull: false,
        defaultValue: 0.001,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        field: "f_sort_order",
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.TINYINT,
        field: "f_status",
        allowNull: false,
        defaultValue: 1,
      },
      createTime: {
        type: DataTypes.DATE,
        field: "f_create_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updateTime: {
        type: DataTypes.DATE,
        field: "f_update_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "SpotSymbol",
      tableName: "t_spot_symbol",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );
}
