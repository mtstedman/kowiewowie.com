<?php

declare(strict_types=1);

namespace Wowie\Api\Trivia;

use Wowie\Api\ApiException;

final class TriviaQuestionCatalog
{
    /** @var list<array{question: string, correct_answer: string, choices: list<string>, explanation: string}> */
    private const DEFAULT_PROMPTS = [
        [
            'question' => 'Which planet is known as the Red Planet?',
            'correct_answer' => 'Mars',
            'choices' => ['Mercury', 'Venus', 'Mars', 'Jupiter'],
            'explanation' => 'Iron oxide dust gives Mars its reddish color.',
        ],
        [
            'question' => 'What is the largest ocean on Earth?',
            'correct_answer' => 'Pacific Ocean',
            'choices' => ['Atlantic Ocean', 'Indian Ocean', 'Pacific Ocean', 'Arctic Ocean'],
            'explanation' => 'The Pacific Ocean covers more area than all land on Earth combined.',
        ],
    ];

    /**
     * @return list<array{question: string, correct_answer: string, choices: list<string>, explanation: ?string}>
     */
    public function resolve(mixed $value): array
    {
        if ($value === null || $value === []) {
            return self::DEFAULT_PROMPTS;
        }
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, 'validation_error', 'prompts must be a list of trivia prompt objects.');
        }
        if (count($value) !== 2) {
            throw new ApiException(422, 'validation_error', 'prompts must contain exactly 2 entries for the two-round trivia game.');
        }

        return array_map(fn (mixed $prompt): array => $this->normalizePrompt($prompt), $value);
    }

    /** @return array{question: string, correct_answer: string, choices: list<string>, explanation: ?string} */
    private function normalizePrompt(mixed $value): array
    {
        if (!is_array($value)) {
            throw new ApiException(422, 'validation_error', 'Each trivia prompt must be an object.');
        }
        $question = trim((string) ($value['question'] ?? ''));
        $correctAnswer = trim((string) ($value['correct_answer'] ?? $value['answer'] ?? ''));
        if ($question === '' || mb_strlen($question) > 300) {
            throw new ApiException(422, 'validation_error', 'Each prompt question must contain 1 to 300 characters.');
        }
        if ($correctAnswer === '' || mb_strlen($correctAnswer) > 200) {
            throw new ApiException(422, 'validation_error', 'Each prompt correct_answer must contain 1 to 200 characters.');
        }
        $choices = $value['choices'] ?? [];
        if ($choices !== [] && (!is_array($choices) || !array_is_list($choices))) {
            throw new ApiException(422, 'validation_error', 'Prompt choices must be a list of answer strings.');
        }
        $choices = array_values(array_map(static fn (mixed $choice): string => trim((string) $choice), is_array($choices) ? $choices : []));
        $choices = array_values(array_filter($choices, static fn (string $choice): bool => $choice !== ''));
        if ($choices !== [] && !in_array($correctAnswer, $choices, true)) {
            $choices[] = $correctAnswer;
        }

        return [
            'question' => $question,
            'correct_answer' => $correctAnswer,
            'choices' => $choices,
            'explanation' => isset($value['explanation']) ? trim((string) $value['explanation']) : null,
        ];
    }
}
