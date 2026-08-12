"use client";

import { useCallback, useEffect, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

export interface Recipe {
  id: string;
  name: string;
  type: "telegram" | "wallet" | "swap";
  tokenSymbol: string;
  tokenMint: string;
  tokenDecimals: number;
  amount: string;
  recipient: string;
  /** Swap-only: target token */
  toTokenSymbol?: string;
  toTokenMint?: string;
  toTokenDecimals?: number;
  photoUrl?: string;
  createdAt: number;
}

const RECIPES_STORAGE_KEY = "loyal-recipes";

// Demo recipe for showcasing the feature
const DEMO_RECIPE: Recipe = {
  id: "demo-recipe",
  name: "Send 0.0001 SOL to Vlad",
  type: "telegram",
  tokenSymbol: "SOL",
  tokenMint: "So11111111111111111111111111111111111111112",
  tokenDecimals: 9,
  amount: "0.0001",
  recipient: "vlad_arbatov",
  photoUrl: "/vlad.jpg",
  createdAt: Date.now(),
};

function loadRecipes(): Recipe[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = localStorage.getItem(RECIPES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecipes(recipes: Recipe[]): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(recipes));
}

export function useRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const { demoRecipeEnabled: showDemoRecipe } = usePublicEnv();

  // Load recipes from localStorage on mount
  useEffect(() => {
    setRecipes(loadRecipes());
  }, []);

  const addRecipe = useCallback((recipe: Omit<Recipe, "id" | "createdAt">) => {
    const newRecipe: Recipe = {
      ...recipe,
      id: `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
    };

    setRecipes((prev) => {
      const updated = [...prev, newRecipe];
      saveRecipes(updated);
      return updated;
    });

    return newRecipe;
  }, []);

  const deleteRecipe = useCallback((id: string) => {
    setRecipes((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      saveRecipes(updated);
      return updated;
    });
  }, []);

  const generateRecipeName = useCallback(
    (recipe: Omit<Recipe, "id" | "createdAt">): string => {
      if (recipe.type === "swap") {
        return `Swap ${recipe.amount} ${recipe.tokenSymbol} → ${recipe.toTokenSymbol}`;
      }
      const target =
        recipe.type === "telegram"
          ? `@${recipe.recipient}`
          : `${recipe.recipient.slice(0, 6)}...`;
      return `Send ${recipe.amount} ${recipe.tokenSymbol} → ${target}`;
    },
    []
  );

  // Include demo recipe if env var is set
  const allRecipes = showDemoRecipe
    ? [DEMO_RECIPE, ...recipes.filter((r) => r.id !== "demo-recipe")]
    : recipes;

  return {
    recipes: allRecipes,
    addRecipe,
    deleteRecipe,
    generateRecipeName,
  };
}
