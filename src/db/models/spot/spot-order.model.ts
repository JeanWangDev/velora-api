import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";

export type SpotOrderSide = "buy" | "sell";
export type SpotOrderType = "limit" | "market";
export type SpotTimeInForce = "gtc" | "post_only" | "ioc" | "fok";
export type SpotOrderStatus = "open" | "partial" | "filled" | "cancelled";

export class SpotOrder extends Model {
  declare id: number;
  declare orderNo: string;
  declare userId: number;
  declare symbol: string;
  declare side: SpotOrderSide;
  declare type: SpotOrderType;
  declare timeInForce: SpotTimeInForce;
  declare price: string | null;
  declare quantity: string;
  declare filledQuantity: string;
  declare avgPrice: string;
  declare quoteSpent: string;
  declare fee: string;
  declare feeCurrency: string;
  declare frozenCurrency: string;
  declare frozenAmount: string;
  declare status: SpotOrderStatus;
  declare createTime: Date;
  declare updateTime: Date;
}

export async function initSpotOrderModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  SpotOrder.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: "f_id" },
      orderNo: { type: DataTypes.STRING(32), field: "f_order_no", allowNull: false, unique: true },
      userId: { type: DataTypes.BIGINT, field: "f_user_id", allowNull: false },
      symbol: { type: DataTypes.STRING(32), field: "f_symbol", allowNull: false },
      side: { type: DataTypes.STRING(8), field: "f_side", allowNull: false },
      type: { type: DataTypes.STRING(8), field: "f_type", allowNull: false },
      timeInForce: {
        type: DataTypes.STRING(16),
        field: "f_time_in_force",
        allowNull: false,
        defaultValue: "gtc",
      },
      price: { type: DataTypes.DECIMAL(36, 12), field: "f_price", allowNull: true },
      quantity: { type: DataTypes.DECIMAL(36, 12), field: "f_quantity", allowNull: false },
      filledQuantity: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_filled_quantity",
        allowNull: false,
        defaultValue: 0,
      },
      avgPrice: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_avg_price",
        allowNull: false,
        defaultValue: 0,
      },
      quoteSpent: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_quote_spent",
        allowNull: false,
        defaultValue: 0,
      },
      fee: { type: DataTypes.DECIMAL(36, 12), field: "f_fee", allowNull: false, defaultValue: 0 },
      feeCurrency: {
        type: DataTypes.STRING(16),
        field: "f_fee_currency",
        allowNull: false,
        defaultValue: "",
      },
      frozenCurrency: {
        type: DataTypes.STRING(16),
        field: "f_frozen_currency",
        allowNull: false,
        defaultValue: "",
      },
      frozenAmount: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_frozen_amount",
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.STRING(16),
        field: "f_status",
        allowNull: false,
        defaultValue: "open",
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
      modelName: "SpotOrder",
      tableName: "t_spot_order",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );
}
