import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";
import type { SpotOrderSide } from "./spot-order.model";

export class SpotTrade extends Model {
  declare id: number;
  declare tradeNo: string;
  declare orderId: number;
  declare orderNo: string;
  declare userId: number;
  declare counterUserId: number;
  declare symbol: string;
  declare side: SpotOrderSide;
  declare price: string;
  declare quantity: string;
  declare fee: string;
  declare feeCurrency: string;
  declare role: "maker" | "taker";
  declare createTime: Date;
}

export async function initSpotTradeModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  SpotTrade.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: "f_id" },
      tradeNo: { type: DataTypes.STRING(32), field: "f_trade_no", allowNull: false, unique: true },
      orderId: { type: DataTypes.BIGINT, field: "f_order_id", allowNull: false },
      orderNo: { type: DataTypes.STRING(32), field: "f_order_no", allowNull: false },
      userId: { type: DataTypes.BIGINT, field: "f_user_id", allowNull: false },
      counterUserId: {
        type: DataTypes.BIGINT,
        field: "f_counter_user_id",
        allowNull: false,
        defaultValue: 0,
      },
      symbol: { type: DataTypes.STRING(32), field: "f_symbol", allowNull: false },
      side: { type: DataTypes.STRING(8), field: "f_side", allowNull: false },
      price: { type: DataTypes.DECIMAL(36, 12), field: "f_price", allowNull: false },
      quantity: { type: DataTypes.DECIMAL(36, 12), field: "f_quantity", allowNull: false },
      fee: { type: DataTypes.DECIMAL(36, 12), field: "f_fee", allowNull: false, defaultValue: 0 },
      feeCurrency: {
        type: DataTypes.STRING(16),
        field: "f_fee_currency",
        allowNull: false,
        defaultValue: "",
      },
      role: {
        type: DataTypes.STRING(8),
        field: "f_role",
        allowNull: false,
        defaultValue: "taker",
      },
      createTime: {
        type: DataTypes.DATE,
        field: "f_create_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "SpotTrade",
      tableName: "t_spot_trade",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );
}
